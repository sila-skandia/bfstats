// Cloud render test for replay Shorts (features/replay-shorts/CLOUD_RENDER_TEST.md).
// Opens a live replay in headless Chromium, measures load, memory, real-time fps,
// then steps the replay clock by hand (1/30 s per frame through window.__renderOnce)
// and grabs each frame, at 1080x1920 and 1280x720, and encodes them with ffmpeg.
//
//   node features/replay-shorts/cloud-render-test.mjs [outDir] [--swiftshader] [--frames=N] [--sizes=WxH,..] [--creator] [--jpeg]
//
// Read-only against production: it loads pages and files, nothing else.
import { createRequire } from 'node:module';
import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = (n, d) => (args.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const outDir = args.find(a => !a.startsWith('--')) ?? 'shorts-out';
const URL = opt('url', 'https://play.bfstats.io/map.html?mod=fhsweurope&map=meuse_river_line-1944&replay=/stats/recordings/xhf8sfkt7k.ndjson&shots');
const KILL_T = Number(opt('kill', 1664.89));
const KILLER = Number(opt('killer', 13));
const FPS = 30;
const PRE = 8, POST = 7;
const MAX_FRAMES = Number(opt('frames', (PRE + POST) * FPS));
const SIZES = (opt('sizes', '1080x1920,1280x720')).split(',').map(s => s.split('x').map(Number));
const CREATOR = flag('--creator');
const JPEG = flag('--jpeg');
const EXT = JPEG ? 'jpg' : 'png';
fs.mkdirSync(outDir, { recursive: true });

// Peak RSS: sum over every process of the browser (Playwright's Chromium lives under /opt/pw-browsers).
let peakRss = 0;
const sampleRss = () => {
  try {
    const out = execSync("ps -eo rss=,args= | grep -E 'pw-browsers|chrom' | grep -v grep", { encoding: 'utf8' });
    const kb = out.trim().split('\n').reduce((s, l) => s + (parseInt(l, 10) || 0), 0);
    peakRss = Math.max(peakRss, kb);
    return kb;
  } catch { return 0; }
};
const sampler = setInterval(sampleRss, 250);
const mb = kb => Math.round(kb / 1024);
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const report = { url: URL, swiftshader: flag('--swiftshader'), creator: CREATOR, jpeg: flag('--jpeg') };

const launchArgs = flag('--swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
const browser = await chromium.launch({ args: launchArgs });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => log('pageerror', e.message));
page.on('console', m => { if (m.type() === 'error') log('console.error', m.text().slice(0, 200)); });

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
report.gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const d = c?.getExtension('WEBGL_debug_renderer_info');
  return c ? c.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : c.RENDERER) : 'no webgl2';
});
log('GL', report.gl);
await page.waitForFunction(() => window.replay?.statusLine, null, { timeout: 600000, polling: 500 });
report.loadSec = (Date.now() - t0) / 1000;
report.status = await page.evaluate(() => window.replay.statusLine);
log('loaded', report.loadSec, 's', report.status);
// Let hull builds and textures settle a moment, as a viewer would see it.
await page.waitForTimeout(3000);
report.rssAfterLoadMb = mb(sampleRss());

// The kill.
const kill = await page.evaluate(({ KILL_T, KILLER }) => {
  const ks = window.replay.rec.kills ?? [];
  const pick = ks.filter(k => Math.abs(k.t - KILL_T) < 1).sort((a, b) => Math.abs(a.t - KILL_T) - Math.abs(b.t - KILL_T))[0] ?? ks[Math.floor(ks.length / 2)];
  return { count: ks.length, keys: pick ? Object.keys(pick) : [], kill: pick ? JSON.parse(JSON.stringify(pick)) : null };
}, { KILL_T, KILLER });
report.kill = kill;
log('kill', JSON.stringify(kill).slice(0, 300));
const kt = kill.kill?.t ?? KILL_T;
const killer = kill.kill?.killer ?? kill.kill?.pid ?? KILLER;

// Real-time baseline: rAF count over 10 s of play from kill - 6 s, following the killer.
report.realtime = await page.evaluate(async ({ kt, killer }) => {
  const r = window.replay;
  r.follow?.(killer);
  r.seek(kt - 6);
  r.playing = true;
  let n = 0;
  let on = true;
  const tick = () => { n++; if (on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const start = performance.now();
  const rt0 = r.time;
  await new Promise(res => setTimeout(res, 10000));
  on = false;
  const sec = (performance.now() - start) / 1000;
  r.playing = false;
  return { fps: +(n / sec).toFixed(2), frames: n, wallSec: +sec.toFixed(2), replaySec: +(r.time - rt0).toFixed(2) };
}, { kt, killer });
log('realtime', report.realtime);
await page.screenshot({ path: path.join(outDir, 'realtime-last.png') });

// Stepped: stop the page's own loop, then one __renderOnce per 1/30 s of replay clock.
await page.evaluate(() => window.__renderer.setAnimationLoop(null));
report.stepped = [];
for (const [w, h] of SIZES) {
  await page.setViewportSize({ width: Math.min(w, 1280), height: Math.min(h, 1280) });
  const dir = path.join(outDir, `frames-${w}x${h}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(({ kt, killer, w, h, creator }) => {
    const r = window.replay;
    r.follow?.(killer);
    r.speed = 1;
    r.seek(kt - 8);
    if (creator) {
      r.creator.grant(true);
      window.__creatorOk = r.creator.killShotAt(kt, null);
    }
    r.playing = true;
    // Two settle frames at no clock step so the seek lands.
    window.__renderOnce(w, h, 0);
    window.__renderOnce(w, h, 0);
  }, { kt, killer, w, h, creator: CREATOR });
  const times = [];
  const gpus = [];
  const totals = [];
  const grabs = [];
  const clock = [];
  for (let i = 0; i < MAX_FRAMES; i++) {
    const tStart = Date.now();
    const res = await page.evaluate(({ w, h, jpeg }) => {
      const a = performance.now();
      window.__renderOnce(w, h, 1 / 30);
      const b = performance.now();
      // The GL calls return before SwiftShader has drawn; finish() waits for it.
      window.__renderer.getContext().finish();
      const g = performance.now();
      const url = window.__renderer.domElement.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.95);
      const c = performance.now();
      return { render: b - a, gpu: g - b, grab: c - g, url, t: window.replay.time, speed: window.replay.speed };
    }, { w, h, jpeg: JPEG });
    const t1 = Date.now();
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.${EXT}`), Buffer.from(res.url.split(',')[1], 'base64'));
    times.push(res.render);
    gpus.push(res.gpu);
    totals.push(Date.now() - tStart);
    grabs.push(res.grab);
    clock.push([+res.t.toFixed(3), +res.speed.toFixed(3)]);
    if (i % 60 === 0) { sampleRss(); log(`${w}x${h} frame ${i} render ${res.render.toFixed(0)}ms gpu ${res.gpu.toFixed(0)}ms grab ${res.grab.toFixed(0)}ms t=${res.t.toFixed(2)} speed=${res.speed.toFixed(2)}`); }
  }
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const p = (a, q) => [...a].sort((x, y) => x - y)[Math.floor(q * (a.length - 1))];
  const wall0 = Date.now();
  const mp4 = path.join(outDir, `clip-${w}x${h}.mp4`);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, `f%04d.${EXT}`),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', mp4]);
  const encSec = (Date.now() - wall0) / 1000;
  const row = {
    size: `${w}x${h}`, frames: times.length,
    renderMsAvg: +avg(times).toFixed(1), renderMsP50: +p(times, 0.5).toFixed(1), renderMsP95: +p(times, 0.95).toFixed(1),
    gpuMsAvg: +avg(gpus).toFixed(1), gpuMsP95: +p(gpus, 0.95).toFixed(1), grabMsAvg: +avg(grabs).toFixed(1),
    frameWallMsAvg: +avg(totals).toFixed(1), stepWallSec: +(totals.reduce((s, x) => s + x, 0) / 1000).toFixed(1), encodeSec: encSec, mp4Bytes: fs.statSync(mp4).size,
    clockFirst: clock[0], clockLast: clock.at(-1),
    creatorOk: CREATOR ? await page.evaluate(() => window.__creatorOk) : undefined,
  };
  fs.writeFileSync(path.join(outDir, `clock-${w}x${h}.json`), JSON.stringify(clock));
  report.stepped.push(row);
  log('stepped', row);
}

clearInterval(sampler);
report.peakRssMb = mb(peakRss);
await browser.close();
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
