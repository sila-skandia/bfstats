// The map page's lost WebGL context, end to end (features/webgl-context-restore):
// load a level, spawn on foot, take the context away, bring it back, and report
// what the page did -- world ticks through the loss, the notice, when drawing
// resumed and how long the warm-up took, the picture before and after (a
// downscaled mean and lit share, plus JPEGs beside --out), and a full turn
// while firing after the restore, which links in-frame whatever the restore
// left cold (`play.programsAfter - play.programsBefore`, `play.max`).
//
//   node contextloss.cjs --base http://localhost:5573 --out /tmp/cl/after.json
//   node contextloss.cjs --crash --out /tmp/cl/crash.json     # a real GPU process crash (CDP Browser.crashGpuProcess)
//   node contextloss.cjs --code <other build's viewer dir> --label before ...
//
// Without --crash the loss is WEBGL_lose_context.loseContext(), restored after
// --restoreMs. One headless Chromium; run it under
// `flock -x /tmp/claude-1000/chromium.lock` when other agents share the PC.
const path = require('node:path');
const { withPage, sleep, parseArgs } = require('./pageprobe.cjs');

const opts = parseArgs({ base: 'http://localhost:5573', map: 'wake', mod: 'bf1942', mode: 'CoOp', out: '', restoreMs: 1000, label: 'run', code: '', crash: false });

const init = () => {
  window.__glEvents = [];
  document.addEventListener('webglcontextlost', () => window.__glEvents.push(['lost', performance.now()]), true);
  document.addEventListener('webglcontextrestored', () => window.__glEvents.push(['restored', performance.now()]), true);
};

(async () => {
  const report = await withPage({ base: opts.base, init, code: opts.code }, async probe => {
    const { ev, step, errors } = probe;
    const t0 = Date.now();
    await probe.open({ mod: opts.mod, map: opts.map, mode: opts.mode });
    const spawned = await probe.spawn(1);
    await probe.settleWeapon();
    await ev(() => window.__warmup());
    await step(20);
    const loadS = (Date.now() - t0) / 1000;
    const sample = () => ev(() => {
      const src = window.__renderer.domElement;
      const c = document.createElement('canvas');
      c.width = 160; c.height = 100;
      const g = c.getContext('2d');
      g.drawImage(src, 0, 0, 160, 100);
      const d = g.getImageData(0, 0, 160, 100).data;
      let r = 0, gg = 0, b = 0, lit = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; gg += d[i + 1]; b += d[i + 2];
        if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
      }
      const n = d.length / 4;
      return { mean: [r / n, gg / n, b / n].map(v => Math.round(v)), lit: +(lit / n).toFixed(3) };
    });
    const info = () => ev(() => {
      const i = window.__renderer.info;
      return { programs: i.programs?.length ?? null, geometries: i.memory.geometries, textures: i.memory.textures,
               ctxLost: window.__renderer.getContext().isContextLost(),
               card: !document.getElementById('gl-lost').hidden,
               cardTitle: document.getElementById('gl-lost-title').textContent,
               ticks: window.__world()?.ticks ?? null };
    });
    const before = { pic: await sample(), info: await info() };
    await probe.capture(path.join(path.dirname(opts.out || '.'), `${opts.label}-before.jpg`));
    await ev(() => { window.__lc = window.__renderer.getContext().getExtension('WEBGL_lose_context'); });
    let crashNote = null;
    if (opts.crash) {
      // A real GPU process crash, the way the device-lost takes it.
      const cdp = await probe.page.context().browser().newBrowserCDPSession();
      crashNote = await cdp.send('Browser.crashGpuProcess').then(() => 'crashed', e => String(e.message).slice(0, 120));
      for (let i = 0; i < 40 && !(await ev(() => window.__glEvents.some(e => e[0] === 'lost'))); i++) await sleep(50);
    } else {
      await ev(() => window.__lc.loseContext());
    }
    // Frames while the context is down: the sim must keep ticking.
    const lostAt = Date.now();
    let threwDuring = null;
    try { await step(60); } catch (e) { threwDuring = String(e.message || e); }
    await sleep(Math.max(0, opts.restoreMs - (Date.now() - lostAt)));
    const during = { info: await info(), pic: await sample() };
    // The page asks for this itself too; a second ask is a no-op.
    if (!opts.crash) await ev(() => { try { window.__lc.restoreContext(); } catch (e) { return String(e); } });
    // Wait for the restored event.
    for (let i = 0; i < 100 && !(await ev(() => window.__glEvents.some(e => e[0] === 'restored'))); i++) await sleep(50);
    const restoredSeen = await ev(() => window.__glEvents.slice());
    // Frames while the page warms (the new build) until it draws again.
    const warmFrames = [];
    const tw = Date.now();
    while (await ev(() => window.__glContext && window.__glContext.state() !== 'live') && Date.now() - tw < 30000) {
      warmFrames.push(await ev(() => { const t = performance.now(); window.__renderOnce(1280, 800); return +(performance.now() - t).toFixed(1); }));
      await sleep(30);
    }
    const warmWallMs = Date.now() - tw;
    // Time each of the first frames that draw after restore.
    const frameMs = [];
    for (let i = 0; i < 6; i++) {
      frameMs.push(await ev(() => { const t = performance.now(); window.__renderOnce(1280, 800); return +(performance.now() - t).toFixed(1); }));
    }
    // Then give the page some real time (its own resume path), stepping.
    const after = [];
    for (let k = 0; k < 6; k++) {
      await sleep(1000);
      await step(10);
      after.push({ t: k + 1, pic: await sample(), info: await info() });
    }
    await probe.capture(path.join(path.dirname(opts.out || '.'), `${opts.label}-after.jpg`));
    // Play after the restore: turn a full circle while firing, the frames
    // that would link whatever the restore left cold.
    const progBefore = await ev(() => window.__renderer.info.programs?.length ?? null);
    const playMs = await ev(() => {
      const out = [];
      window.__setTrigger?.(true);
      for (let i = 0; i < 90; i++) {
        const t = performance.now();
        window.__lookDelta?.(32, 0);
        window.__renderOnce(1280, 800);
        out.push(+(performance.now() - t).toFixed(1));
      }
      window.__setTrigger?.(false);
      return out;
    });
    const play = { programsBefore: progBefore, programsAfter: await ev(() => window.__renderer.info.programs?.length ?? null),
                   max: Math.max(...playMs), sum: +playMs.reduce((a, b) => a + b, 0).toFixed(1), top5: [...playMs].sort((a, b) => b - a).slice(0, 5) };
    const guard = await ev(() => window.__glContext ? { state: window.__glContext.state(), history: window.__glContext.history() } : null);
    const programsAfter = await ev(() => window.__renderer.info.programs?.length ?? null);
    const fw = warmFrames.length;
    return { label: opts.label, crash: opts.crash, crashNote, loadS, spawned, before, threwDuring, during, restoredSeen,
             warmFrames: { n: fw, max: fw ? Math.max(...warmFrames) : 0, wallMs: warmWallMs }, frameMs, after, guard, programsAfter, play,
             errors: errors.slice(0, 40) };
  });
  const s = JSON.stringify(report, null, 1);
  if (opts.out) require('node:fs').writeFileSync(opts.out, s);
  console.log(s);
})().catch(e => { console.error(e); process.exit(1); });
