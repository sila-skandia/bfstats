// An example Short filmed the way the nightly job would: the live replay page in
// headless Chromium, the creator's kill shot recorded through its own recording
// path (Shorts recipe, 9:16 frame, grade, lower third, tag, flash, freeze), with
// the clock stepped by hand at 30 fps instead of played in real time.
//
//   node features/replay-shorts/shorts-example.mjs [outDir] [--swiftshader] [--kill=1664.892] [--victim=6]
//
// Nothing in the viewer changes. Two things are swapped from outside the page:
//  - MediaRecorder / captureStream are stubbed, so the creator "records" without
//    encoding; each frame is read from its composed canvas (`recorder.source`)
//    after `__renderOnce`, and ffmpeg makes the MP4.
//  - performance.now() is a virtual clock moved 1/30 s per frame, so the
//    creator's real-time pieces (the freeze on the kill) last their length in
//    the video rather than on the wall.
// Read-only against production.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const opt = (n, d) => (args.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const outDir = args.find(a => !a.startsWith('--')) ?? 'shorts-example';
const URL = opt('url', 'https://play.bfstats.io/map.html?mod=fhsweurope&map=meuse_river_line-1944&replay=/stats/recordings/xhf8sfkt7k.ndjson&shots');
const KILL_T = Number(opt('kill', 1664.892));
const VICTIM = Number(opt('victim', 6));
const W = 1080, H = 1920, FPS = 30;
const MAX_FRAMES = Number(opt('max', 1800));
const framesDir = path.join(outDir, 'frames');
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const browser = await chromium.launch({ args: args.includes('--swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1280 } });
page.on('pageerror', e => log('pageerror', e.message));
await page.addInitScript(() => {
  // Virtual clock: real until the harness takes it over.
  const realNow = performance.now.bind(performance);
  let virtual = null;
  performance.now = () => (virtual === null ? realNow() : virtual);
  window.__clock = { take() { virtual = realNow(); }, step(ms) { virtual += ms; } };
  // A recorder that records nothing: the harness reads the composed canvas.
  class StubRecorder {
    static isTypeSupported(t) { return /webm|mp4/.test(t); }
    constructor(stream, o) { this.state = 'inactive'; this.mimeType = o?.mimeType; }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; setTimeout(() => this.onstop?.(), 0); }
  }
  window.MediaRecorder = StubRecorder;
  HTMLCanvasElement.prototype.captureStream = () => ({ getTracks: () => [], getAudioTracks: () => [], addTrack() {} });
});

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.replay?.statusLine, null, { timeout: 600000, polling: 500 });
log('loaded in', (Date.now() - t0) / 1000, 's');
await page.waitForTimeout(3000);

const setup = await page.evaluate(async ({ KILL_T, VICTIM, W, H }) => {
  const r = window.replay;
  const c = r.creator;
  window.__renderer.setAnimationLoop(null);
  window.__clock.take();
  c.grant(true);
  c.toggle(true);
  // The studio's Shorts recipe, as its button applies it.
  const { RECIPES, applyRecipe } = await import(new URL('replay-studio.js', location.href).href);
  const [, , , edits, frame] = RECIPES.find(([id]) => id === 'shorts');
  c.prefs.frame = frame;
  c.edits = applyRecipe(c.edits, edits);
  c.syncFrame?.();
  const row = c.killAt(KILL_T, VICTIM);
  if (!row?.round?.f) return { ok: false, why: 'no round tied to the kill' };
  window.__renderOnce(W, H, 0);
  c.recordShort(row);
  window.__renderOnce(W, H, 0);
  return { ok: Boolean(c.recorder), span: c.span, shot: row.round.f.t, kill: row.kill?.t, weapon: row.round.f.weapon, edits: c.edits };
}, { KILL_T, VICTIM, W, H });
log('setup', JSON.stringify(setup).slice(0, 400));
if (!setup.ok) process.exit(1);

let n = 0;
const stepMs = [];
const clock = [];
const wall0 = Date.now();
for (let i = 0; i < MAX_FRAMES; i++) {
  const a = Date.now();
  const res = await page.evaluate(({ W, H, FPS }) => {
    window.__clock.step(1000 / FPS);
    window.__renderOnce(W, H, 1 / FPS);
    const rec = window.replay.creator.recorder;
    const out = { t: window.replay.time, speed: window.replay.speed, playing: window.replay.playing, rec: Boolean(rec), started: Boolean(rec?.started) };
    if (rec?.started) {
      const src = rec.source ?? window.__renderer.domElement;
      out.size = [src.width, src.height];
      out.url = src.toDataURL('image/jpeg', 0.95);
    }
    return out;
  }, { W, H, FPS });
  if (res.url) {
    fs.writeFileSync(path.join(framesDir, `f${String(n).padStart(4, '0')}.jpg`), Buffer.from(res.url.split(',')[1], 'base64'));
    n++;
    stepMs.push(Date.now() - a);
    clock.push([+res.t.toFixed(3), +res.speed.toFixed(3), res.playing]);
  }
  if (i % 30 === 0) log(`step ${i} recorded ${n} t=${res.t.toFixed(2)} speed=${res.speed.toFixed(2)} playing=${res.playing} size=${res.size} ${Date.now() - a}ms`);
  if (!res.rec && n > 0) break;
}
const wallSec = (Date.now() - wall0) / 1000;
fs.writeFileSync(path.join(outDir, 'clock.json'), JSON.stringify(clock));
const mp4 = path.join(outDir, 'short-example.mp4');
execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(framesDir, 'f%04d.jpg'),
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
const summary = {
  frames: n, videoSec: +(n / FPS).toFixed(2), stepWallSec: wallSec,
  msPerFrame: +(stepMs.reduce((s, x) => s + x, 0) / Math.max(1, n)).toFixed(0),
  minSpeed: Math.min(...clock.map(c => c[1])), roundSpan: [clock[0]?.[0], clock.at(-1)?.[0]], mp4Bytes: fs.statSync(mp4).size,
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ setup, summary }, null, 2));
log('done', summary);
await browser.close();
