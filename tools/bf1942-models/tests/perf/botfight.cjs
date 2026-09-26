#!/usr/bin/env node
// What a frame costs with N bots fighting at close quarters on map.html:
// the sim, the AI, the bodies and the render together, in one Chromium,
// closed at the end. Writes <out>/<label>.cpuprofile, <out>/summary.json and
// a frame of the fight. The findings it produced are in
// features/bot-fight-performance/README.md.
//
//   # stepped frames (deterministic, headless on Vulkan ANGLE): a CPU profile
//   node botfight.cjs --map el_alamein --bots 16 --frames 900 --out out/fight-16
//   # the player's own conditions: a window on the system GL, the page's own
//   # loop, 20 s of real time per run (fps, frame-time percentiles, GPU share)
//   node botfight.cjs --headed --realtime 20 --bots 16 --out out/fight-16-headed
//   # a natural match instead of the staged lines; a build on another port
//   node botfight.cjs --natural --base http://localhost:5677 ...
//
// Runs: `fight` (the two sides in lines `--gap` m apart across `--flag`,
// restaged every `--restage` frames / 10 s), `noai` (the same bodies with
// every bot's tick emptied: the draw and the bodies alone), `base` (the page
// with no bots). `--flag x,y,z` is the flag's position; the default is El
// Alamein's EastOpenBase. One browser at a time: it waits for any other
// headless Chromium to finish (the owner tests on this machine).
const { execSync } = require('node:child_process');
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

const opts = { base: 'http://localhost:5273', map: 'el_alamein', bots: 16, frames: 900, gap: 30, spacing: 3,
  flag: [1343.9, 45.4, -1380.0], out: 'out/botfight', w: 1280, h: 800, noaudio: false, restage: 600,
  runs: 'fight,noai,base', wait: 600, natural: false, headed: false, realtime: 0, pitch: -0.12 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, ''), v = argv[i + 1];
  if (k === 'noaudio') opts.noaudio = true;
  else if (k === 'natural') opts.natural = true;
  else if (k === 'headed') opts.headed = true;
  else if (k in opts) { opts[k] = typeof opts[k] === 'number' ? +v : k === 'flag' ? v.split(',').map(Number) : v; i++; }
  else throw new Error(`unknown --${k}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(opts.out, { recursive: true });

function headlessPids() {
  try {
    return execSync("ps -eo pid,args | grep -E '[h]eadless_shell|[c]hrome-linux/chrome '").toString().trim().split('\n').filter(Boolean)
      .map(l => { const m = l.trim().match(/^(\d+)\s+(.*)$/); return { pid: +m[1], type: (m[2].match(/--type=([\w-]+)/) || [])[1] || 'browser' }; });
  } catch { return []; }
}
function threadTicks(pids) {
  const out = new Map();
  for (const { pid, type } of pids) {
    let tids = [];
    try { tids = fs.readdirSync(`/proc/${pid}/task`); } catch { continue; }
    for (const tid of tids) {
      try {
        const comm = fs.readFileSync(`/proc/${pid}/task/${tid}/comm`, 'utf8').trim();
        const stat = fs.readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8');
        const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const ticks = +f[11] + +f[12];
        const key = `${type}:${comm}`;
        out.set(key, (out.get(key) || 0) + ticks);
      } catch {}
    }
  }
  return out;
}
function threadCpu(before, after, seconds) {
  const rows = [];
  for (const [k, v] of after) {
    const d = (v - (before.get(k) || 0)) / 100;
    if (d > 0.05) rows.push({ thread: k, cpuS: +d.toFixed(2), pctCore: +(100 * d / seconds).toFixed(1) });
  }
  return rows.sort((a, b) => b.cpuS - a.cpuS).slice(0, 12);
}
function selfTime(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const selfMs = new Map(), byFile = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const cf = byId.get(profile.samples[i]).callFrame;
    const file = cf.url.split('/').pop().split('?')[0] || `(${cf.functionName || 'native'})`;
    const key = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`;
    const dt = (profile.timeDeltas[i] || 0) / 1000;
    total += dt;
    selfMs.set(key, (selfMs.get(key) || 0) + dt);
    byFile.set(file, (byFile.get(file) || 0) + dt);
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => ({ share: +(100 * v / total).toFixed(1), ms: Math.round(v), fn: k }));
  return { totalMs: Math.round(total), topFn: top(selfMs, 45), topFile: top(byFile, 25) };
}

async function main() {
  for (let i = 0; i < opts.wait / 5 && headlessPids().length; i++) {
    if (i === 0) console.error('another headless browser is running; waiting');
    await sleep(5000);
  }
  if (headlessPids().length) throw new Error('another headless browser still running; giving up');
  const browser = await chromium.launch({ headless: !opts.headed, args: [
    ...(opts.headed ? [] : ['--use-angle=vulkan', '--enable-features=Vulkan']), '--ignore-gpu-blocklist',
    '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] });
  const pids = headlessPids();
  const page = await browser.newPage({ viewport: { width: opts.w, height: opts.h }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    window.__audioCounts = { panners: 0, hrtf: 0, sources: 0 };
    const cp = AudioContext.prototype.createPanner;
    AudioContext.prototype.createPanner = function () {
      const p = cp.apply(this, arguments); window.__audioCounts.panners++;
      const d = Object.getOwnPropertyDescriptor(PannerNode.prototype, 'panningModel');
      Object.defineProperty(p, 'panningModel', { set(v) { if (v === 'HRTF') window.__audioCounts.hrtf++; d.set.call(this, v); }, get() { return d.get.call(this); } });
      return p;
    };
    const st = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () { window.__audioCounts.sources++; return st.apply(this, arguments); };
  });
  const logs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });

  const [fx, fy, fz] = opts.flag;
  const cam = `${fx},${fy + 9},${fz - 48},0,${opts.pitch ?? 0.14}`;
  const step = (n, dt = 1 / 60) => page.evaluate(([n, w, h, dt]) => {
    const t = new Array(n);
    for (let i = 0; i < n; i++) { const a = performance.now(); window.__renderOnce(w, h, dt); t[i] = performance.now() - a; }
    return t;
  }, [n, opts.w, opts.h, dt]);
  const info = () => page.evaluate(() => {
    const r = window.__renderer, s = window.__scene;
    let meshes = 0, skinned = 0, unculled = 0;
    const skels = new Set(), boneTex = new Set();
    let drawnSkinned = 0;
    const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    s.traverse(o => { if (o.isMesh) meshes++; if (o.isSkinnedMesh) { skinned++; if (!o.frustumCulled) unculled++; if (shown(o)) drawnSkinned++; skels.add(o.skeleton); if (o.skeleton?.boneTexture) boneTex.add(o.skeleton.boneTexture); } });
    const bots = window.__bots ? window.__bots() : [];
    return {
      calls: r.info.render.calls, tris: r.info.render.triangles, geometries: r.info.memory.geometries,
      textures: r.info.memory.textures, programs: r.info.programs?.length, meshes, skinned, drawnSkinned, skeletons: skels.size, boneTextures: boneTex.size, unculled,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      audio: { ...window.__audioCounts },
      bots: bots.length, alive: bots.filter(b => b.hp > 0).length, mounted: bots.filter(b => b.vehicle).length,
      firing: bots.filter(b => b.firing).length, memory: bots.map(b => b.memory).join(','),
      behaviours: bots.map(b => b.behaviour).join(','),
      effects: (() => { const e = window.__effects?.(); if (!e) return null; const o = {}; for (const [k, v] of Object.entries(e)) if (typeof v === 'number') o[k] = v; return o; })(),
    };
  });

  async function loadPage(bots) {
    const url = `${opts.base}/map.html?mod=bf1942&map=${opts.map}&botCount=${bots}&botSkill=0.75&shots&cam=${cam}${opts.noaudio ? '&noaudio' : ''}`;
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(n => window.__renderOnce && window.__scene && (!n || (window.__bots && window.__bots().length >= n)), bots, { timeout: 300000 });
    await page.waitForLoadState('networkidle', { timeout: 300000 }).catch(() => {});
    await page.evaluate(() => window.__setFly?.(true));
    // The camera 48 m south of the flag, 8 m over the ground THERE (the flag's
    // own height put it under a dune), looking +z at the lines.
    await page.evaluate(([fx, fz, pitch]) => {
      const ctl = window.__bots?.().length ? window.__botCtl(window.__bots()[0].id) : null;
      const g = ctl?.world?.groundHeight?.(fx, fz - 48);
      if (window.__camera && window.__look && Number.isFinite(g)) {
        window.__camera.position.set(fx, g + 8, fz - 48);
        window.__look.yaw = 0; window.__look.pitch = pitch;
      }
    }, [fx, fz, opts.pitch]);
    if (opts.realtime) { await sleep(2000); await sleep(3000); } else { await step(120); await sleep(3000); await step(40); }
    await page.mouse.click(opts.w / 2, opts.h / 2);
    if (bots) await page.waitForFunction(() => window.__bots().every(b => b.weapon), null, { timeout: 30000 }).catch(() => {});
    return (Date.now() - t0) / 1000;
  }
  async function installStage() {
    return page.evaluate(([flag, gap, spacing]) => {
      const ids = window.__bots().map(b => b.id);
      for (const id of ids) {
        const c = window.__botCtl(id); if (!c) continue;
        if (c.vehicle) { try { window.__botDismount(id); } catch (_) {} }
        Object.defineProperty(c, 'vehicleCandidates', { get: () => [], set() {}, configurable: true });
        Object.defineProperty(c, 'enterRequest', { get: () => null, set() {}, configurable: true });
      }
      window.__stageFight = () => {
        const [cx, cy, cz] = flag;
        const ctls = ids.map(id => window.__botCtl(id)).filter(Boolean);
        const world = ctls[0]?.world; if (!world) return 0;
        const byTeam = { 1: [], 2: [] }; for (const c of ctls) byTeam[c.team]?.push(c);
        let placed = 0;
        for (const team of [1, 2]) {
          const list = byTeam[team]; const zc = cz + (team === 1 ? -gap / 2 : gap / 2); const yaw = team === 1 ? 0 : Math.PI;
          list.forEach((c, i) => {
            if (world.armorOf(c.playerId)?.destroyed || c.vehicle) return;
            const x = cx + (i - (list.length - 1) / 2) * spacing + (Math.random() - 0.5);
            const z = zc + (Math.random() - 0.5) * 2;
            const h = world.groundHeight(x, z); const y = Number.isFinite(h) ? h : cy;
            const p = world.player(c.playerId); if (!p?.soldier) return;
            p.soldier.spawn(x, y, z, yaw); c.setPosition(x, y, z); c.route = null; c.onRespawn?.(); placed++;
          });
        }
        return placed;
      };
      return ids.length;
    }, [opts.flag, opts.gap, opts.spacing]);
  }
  async function measure(label, frames, { restage = 0 } = {}) {
    const before = threadTicks(pids);
    const wall0 = Date.now();
    await cdp.send('Profiler.start');
    let times = []; let placed = 0;
    if (opts.realtime && restage) {
      placed += await page.evaluate(() => window.__stageFight());
      await sleep(400);
      try { fs.writeFileSync(path.join(opts.out, `${label}-start.jpg`), await page.screenshot({ type: 'jpeg', quality: 60 })); } catch (e) { logs.push(`shot failed: ${e.message}`); }
    }
    if (opts.realtime) {
      // The page's own loop runs (a window): sample rAF intervals for S seconds, restaging every 10 s.
      const total = opts.realtime * 1000;
      for (let t = 0; t < total; t += 10000) {
        if (restage) placed += await page.evaluate(() => window.__stageFight());
        times.push(...await page.evaluate(ms => new Promise(res => {
          const out = []; let last = performance.now(); const t0 = last;
          const tick = now => { out.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(tick); else res(out.slice(1)); };
          requestAnimationFrame(tick);
        }), Math.min(10000, total - t)));
      }
      frames = times.length;
    } else {
      for (let done = 0; done < frames;) {
        if (restage && done % restage === 0) placed += await page.evaluate(() => window.__stageFight());
        const n = Math.min(150, frames - done, restage ? restage - (done % restage) : 150);
        times.push(...await step(n)); done += n;
      }
    }
    const { profile } = await cdp.send('Profiler.stop');
    const seconds = (Date.now() - wall0) / 1000;
    const after = threadTicks(pids);
    const sorted = [...times].sort((a, b) => a - b);
    const q = p => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2);
    fs.writeFileSync(path.join(opts.out, `${label}.cpuprofile`), JSON.stringify(profile));
    const rec = {
      label, frames, placed, wallS: +seconds.toFixed(1),
      meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1),
      over16: times.filter(t => t > 16.7).length, over33: times.filter(t => t > 33.3).length,
      tickFramesMean: +(times.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(times.length / 2))).toFixed(2),
      idleFramesMean: +(times.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / Math.max(1, Math.ceil(times.length / 2))).toFixed(2),
      info: await info(), threads: threadCpu(before, after, seconds), profile: selfTime(profile),
    };
    console.log(JSON.stringify({ ...rec, profile: undefined, threads: undefined }));
    return rec;
  }

  const results = { opts, runs: [] };
  const want = opts.runs.split(',');
  if (want.includes('fight') || want.includes('noai')) {
    const loadS = await loadPage(opts.bots);
    const n = opts.natural ? (await page.evaluate(() => { window.__stageFight = () => 0; return window.__bots().length; })) : await installStage();
    console.log(JSON.stringify({ loaded: opts.map, bots: n, loadS, camera: cam }));
    if (want.includes('fight')) results.runs.push(await measure(opts.natural ? 'natural' : 'fight', opts.frames, { restage: opts.natural ? 0 : opts.restage }));
    // A frame of the fight for the record.
    try {
      const jpg = opts.realtime ? (await page.screenshot({ type: 'jpeg', quality: 70 })).toString('base64') : (await page.evaluate(() => window.__renderer.domElement.toDataURL('image/jpeg', 0.7))).split(',')[1];
      fs.writeFileSync(path.join(opts.out, 'fight.jpg'), Buffer.from(jpg, 'base64'));
    } catch (e) { logs.push(`shot failed: ${e.message}`); }
    if (want.includes('noai')) {
      await page.evaluate(() => { for (const b of window.__bots()) { const c = window.__botCtl(b.id); c.tick = () => {}; c.isFiring = false; } });
      results.runs.push(await measure('noai', Math.min(opts.frames, 600)));
    }
  }
  if (want.includes('base')) {
    const loadS = await loadPage(0);
    console.log(JSON.stringify({ loaded: opts.map, bots: 0, loadS }));
    results.runs.push(await measure('base', Math.min(opts.frames, 600)));
  }
  results.logs = logs.slice(0, 40);
  fs.writeFileSync(path.join(opts.out, 'summary.json'), JSON.stringify(results, null, 2));
  await browser.close();
  for (const r of results.runs) {
    console.log(`\n=== ${r.label}: ${r.frames} frames, mean ${r.meanMs} ms (tick frames ${r.tickFramesMean}, idle ${r.idleFramesMean}), p50 ${r.p50}, p95 ${r.p95}, p99 ${r.p99}, max ${r.max}; >16.7 ms ${r.over16}, >33 ms ${r.over33}`);
    console.log(`  draws ${r.info.calls}, tris ${r.info.tris}, meshes ${r.info.meshes}, skinned ${r.info.skinned} (drawn ${r.info.drawnSkinned}, skeletons ${r.info.skeletons}, bone textures ${r.info.boneTextures}), heap ${r.info.heapMB} MB, audio ${JSON.stringify(r.info.audio)}, alive ${r.info.alive}/${r.info.bots}, mounted ${r.info.mounted}, firing ${r.info.firing}`);
    console.log(`  threads: ${r.threads.map(t => `${t.thread} ${t.pctCore}%`).join(' | ')}`);
    console.log(`  --- self time by file (of ${r.profile.totalMs} ms)`);
    for (const f of r.profile.topFile.slice(0, 14)) console.log(`   ${String(f.share).padStart(5)}%  ${String(f.ms).padStart(6)} ms  ${f.fn}`);
    console.log(`  --- self time by function`);
    for (const f of r.profile.topFn.slice(0, 30)) console.log(`   ${String(f.share).padStart(5)}%  ${String(f.ms).padStart(6)} ms  ${f.fn}`);
  }
  if (logs.length) console.log(`\n--- console: ${logs.length}\n${logs.slice(0, 15).join('\n')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
