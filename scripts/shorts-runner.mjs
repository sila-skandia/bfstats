#!/usr/bin/env node
// Replay Shorts render job (features/replay-shorts): finds the kills worth a
// Short in the newest shared recordings, films each one on the live replay page
// in the creator's Shorts look, and uploads it to the Shorts API.
//
//   node scripts/shorts-runner.mjs [--recordings=6] [--recording=<slug>]... [--max=3]
//        [--api=https://bfstats.io] [--play=https://play.bfstats.io]
//        [--out=~/.cache/bfstats-shorts] [--upload] [--to=<api>] [--gpu|--swiftshader]
//   node scripts/shorts-runner.mjs --upload-filmed [--out=...] [--to=<api>]
//
// --upload-filmed films nothing: it uploads every Short already filmed under
// --out (a folder holding meta.json, short.mp4 and poster.jpg).
//
// Without --upload it films and keeps the files only. With it, the key comes
// from SHORTS_UPLOAD_KEY (the API's Shorts__UploadKey).
//
// How a Short is filmed: the page is the live play site with `&shots` (its
// test hooks). The creator's one-click short (`creator.recordShort`) with the
// studio's Shorts recipe applied runs through its own recording path; only the
// encoder and the wall clock are swapped from outside the page. MediaRecorder
// is stubbed and each composed frame is read off `recorder.source` after
// `__renderOnce`; performance.now() is a virtual clock moved 1/30 s a frame, so
// the freeze on the kill lasts its length in the video. ffmpeg makes the MP4.
// (features/replay-shorts/CLOUD_RENDER_TEST.md has the measurements.)
//
// One headless browser at a time; one page load per recording, every Short of
// that recording filmed on it.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = path.join(REPO, 'tools/bf1942-models/viewer');
const { installModuleHooks } = await import(pathToFileURL(path.join(REPO, 'tools/bf1942-models/sim/env.mjs')).href);
installModuleHooks(VIEWER);
const imp = name => import(pathToFileURL(path.join(VIEWER, name)).href);
const [R, P] = await Promise.all([imp('replay-recording.js'), imp('replay-shorts-pick.js')]);
const { chromium } = createRequire(path.join(REPO, 'ui/package.json'))('playwright');

const args = process.argv.slice(2);
const opt = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const many = n => args.filter(a => a.startsWith(`--${n}=`)).map(a => a.slice(n.length + 3));
const API = opt('api', 'https://bfstats.io');
const PLAY = opt('play', 'https://play.bfstats.io');
/** Where the Shorts go, and whose keys say what is already clipped: the API by default. */
const TO = opt('to', API);
const OUT = opt('out', path.join(os.homedir(), '.cache/bfstats-shorts'));
const MAX = Number(opt('max', P.MAX_PER_RECORDING));
const NEWEST = Number(opt('recordings', 6));
const FILMED = args.includes('--upload-filmed');
const UPLOAD = FILMED || args.includes('--upload');
const KEY = process.env.SHORTS_UPLOAD_KEY ?? '';
const W = 1080, H = 1920, FPS = 30;
const MAX_FRAMES = 60 * FPS;
const LOAD_TIMEOUT = 8 * 60 * 1000;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

if (UPLOAD && !KEY) {
  console.error('--upload needs SHORTS_UPLOAD_KEY');
  process.exit(2);
}

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** The recordings to look at: those named, else the newest. */
async function recordingsToDo() {
  const named = many('recording');
  if (named.length) return Promise.all(named.map(s => json(`${API}/stats/recordings/${s}`)));
  const page = await json(`${API}/stats/recordings?page=1&pageSize=${NEWEST}`);
  return page.items;
}

/** The tree's models, `Map<lower name, row>`: the mod's own, else vanilla's. */
function modelsOf(mod) {
  const own = path.join(VIEWER, 'models/mods', String(mod).toLowerCase(), 'models.json');
  const file = fs.existsSync(own) ? own : path.join(VIEWER, 'models/models.json');
  return new Map(JSON.parse(fs.readFileSync(file, 'utf8')).map(m => [m.name.toLowerCase(), m]));
}

function playUrl(r) {
  const q = new URLSearchParams({ mod: r.mod, map: r.level, replay: r.recordingUrl });
  return `${PLAY}/map.html?${q.toString().replace(/%2F/g, '/')}&shots`;
}

async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1280 } });
  page.on('pageerror', e => log('pageerror', e.message.slice(0, 200)));
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    let virtual = null;
    performance.now = () => (virtual === null ? realNow() : virtual);
    window.__clock = { take() { if (virtual === null) virtual = realNow(); }, step(ms) { virtual += ms; } };
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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.replay?.statusLine, null, { timeout: LOAD_TIMEOUT, polling: 1000 });
  // The hulls and bodies keep arriving for a while after the status line.
  await page.waitForTimeout(8000);
  log('loaded in', Math.round((Date.now() - t0) / 1000), 's');
  await page.evaluate(async () => {
    window.__renderer.setAnimationLoop(null);
    window.__clock.take();
    const c = window.replay.creator;
    c.grant(true);
    c.toggle(true);
    const { RECIPES, applyRecipe } = await import(new URL('replay-studio.js', location.href).href);
    const [, , , edits, frame] = RECIPES.find(([id]) => id === 'shorts');
    c.prefs.frame = frame;
    c.edits = applyRecipe(c.edits, edits);
    c.syncFrame?.();
  });
  return page;
}

/** One Short filmed into `dir`: frames, then the MP4 and its poster. */
async function film(page, cand, dir) {
  const frames = path.join(dir, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  const setup = await page.evaluate(({ t, victim, W, H, kv, vv, weapon }) => {
    const c = window.replay.creator;
    const row = c.killAt(t, victim);
    if (!row?.round?.f) return { ok: false, why: 'the page ties no round to the kill' };
    window.__renderOnce(W, H, 0);
    c.recordShort(row);
    window.__renderOnce(W, H, 0);
    const d = s => (s ? c.display(s) || s : null);
    return { ok: Boolean(c.recorder), kill: row.kill?.t ?? t, names: { killerVehicle: d(kv), victimVehicle: d(vv), weapon: d(weapon) } };
  }, { t: cand.t, victim: cand.victim, W, H, kv: cand.killerVehicle, vv: cand.victimVehicle, weapon: cand.weapon });
  if (!setup.ok) return { ok: false, why: setup.why ?? 'the recorder did not start' };
  let n = 0;
  let hitFrame = null;
  for (let i = 0; i < MAX_FRAMES; i++) {
    const res = await page.evaluate(({ W, H, FPS }) => {
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      const c = window.replay.creator;
      const rec = c.recorder;
      const out = { rec: Boolean(rec), state: c.rounds?.state ?? null };
      if (rec?.started) out.url = (rec.source ?? window.__renderer.domElement).toDataURL('image/jpeg', 0.92);
      return out;
    }, { W, H, FPS });
    if (res.url) {
      fs.writeFileSync(path.join(frames, `f${String(n).padStart(4, '0')}.jpg`), Buffer.from(res.url.split(',')[1], 'base64'));
      if (hitFrame === null && res.state === 'impact') hitFrame = n;
      n++;
    }
    if (!res.rec && n > 0) break;
  }
  if (n < FPS) return { ok: false, why: `only ${n} frames` };
  const mp4 = path.join(dir, 'short.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.jpg'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-maxrate', '12M', '-bufsize', '24M',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  const at = posterFrame(frames, n, hitFrame);
  const poster = path.join(dir, 'poster.jpg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(frames, `f${String(at).padStart(4, '0')}.jpg`),
    '-vf', 'scale=540:960', '-q:v', '4', poster]);
  fs.rmSync(frames, { recursive: true, force: true });
  return { ok: true, mp4, poster, frames: n, lengthSeconds: Math.round((n / FPS) * 10) / 10, names: setup.names };
}

/** The poster's frame: of the three seconds after the round lands, the
 *  one whose mean brightness is nearest the middle, so not the white of the
 *  hit flash nor the black of a fade (measured, ffmpeg signalstats). The
 *  middle of the Short when the round cam never reached the hit. */
function posterFrame(frames, n, hitFrame) {
  if (hitFrame === null) return Math.floor(n / 2);
  const from = Math.min(n - 1, hitFrame + 6);
  const count = Math.max(1, Math.min(n - from, 90));
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-start_number', String(from), '-i', path.join(frames, 'f%04d.jpg'),
      '-frames:v', String(count), '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const avgs = [...out.matchAll(/YAVG=([\d.]+)/g)].map(m => Number(m[1]));
    let best = 0;
    avgs.forEach((y, i) => { if (Math.abs(y - 110) < Math.abs(avgs[best] - 110)) best = i; });
    return from + best;
  } catch {
    return Math.min(n - 1, hitFrame + 20);
  }
}

async function upload(meta, made) {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  form.append('video', new Blob([fs.readFileSync(made.mp4)], { type: 'video/mp4' }), 'short.mp4');
  form.append('poster', new Blob([fs.readFileSync(made.poster)], { type: 'image/jpeg' }), 'poster.jpg');
  const res = await fetch(`${TO}/stats/shorts`, { method: 'POST', body: form, headers: { 'X-Shorts-Key': KEY } });
  const body = await res.text();
  if (!res.ok) throw new Error(`upload ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

if (FILMED) {
  const done = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === 'meta.json' ? [dir] : []));
  for (const dir of walk(OUT)) {
    const made = { mp4: path.join(dir, 'short.mp4'), poster: path.join(dir, 'poster.jpg') };
    if (!fs.existsSync(made.mp4) || !fs.existsSync(made.poster)) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    try {
      const short = await upload(meta, made);
      log(`uploaded ${short.slug} "${meta.title}"`);
      done.push({ title: meta.title, slug: short.slug });
    } catch (e) {
      log(`${dir}: ${e.message}`);
    }
  }
  console.log(JSON.stringify(done, null, 2));
  process.exit(0);
}

const summary = [];
const browser = await chromium.launch({
  args: args.includes('--swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : args.includes('--gpu') ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] : [],
});
try {
  for (const r of await recordingsToDo()) {
    try {
      const text = await (await fetch(`${API}${r.recordingUrl}`)).text();
      const rec = R.parseRecording(text);
      const cands = P.shortCandidates(rec, { models: modelsOf(r.mod), slug: r.slug });
      const keys = await json(`${TO}/stats/shorts/keys?recording=${r.slug}`).then(k => new Set(k.keys)).catch(() => new Set());
      const picks = P.pickShorts(cands, { max: MAX, taken: keys });
      log(`${r.slug} ${r.level} (${r.mod}): ${cands.length} candidates, ${picks.length} to film`);
      if (!picks.length) continue;
      const page = await openPage(browser, playUrl(r));
      try {
        for (const c of picks) {
          const dir = path.join(OUT, r.slug, `${c.t.toFixed(2)}-${c.victim}`);
          fs.mkdirSync(dir, { recursive: true });
          const t0 = Date.now();
          const made = await film(page, c, dir);
          if (!made.ok) {
            log(`  skip ${c.kind} at ${c.t.toFixed(1)}: ${made.why}`);
            continue;
          }
          const display = s => (s === c.killerVehicle ? made.names.killerVehicle : s === c.victimVehicle ? made.names.victimVehicle : s === c.weapon ? made.names.weapon : s) ?? s;
          const meta = {
            recordingSlug: r.slug, killTime: Number(c.t.toFixed(2)), victimPid: c.victim, kind: c.kind,
            title: P.titleOf(c, display), killer: c.killerName, victim: c.victimName, weapon: display(c.weapon) ?? '',
            killerVehicle: c.killerVehicle ? display(c.killerVehicle) : null, victimVehicle: c.victimVehicle ? display(c.victimVehicle) : null,
            distance: c.distance, lengthSeconds: made.lengthSeconds, level: r.level, mod: r.mod,
          };
          fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
          log(`  filmed "${meta.title}" ${made.frames} frames in ${Math.round((Date.now() - t0) / 1000)} s, ${(fs.statSync(made.mp4).size / 1e6).toFixed(1)} MB`);
          let slug = null;
          if (UPLOAD) {
            const short = await upload(meta, made);
            slug = short.slug;
            log(`  uploaded ${slug}`);
          }
          summary.push({ recording: r.slug, title: meta.title, kind: c.kind, dir, slug });
        }
      } finally {
        await page.close();
      }
    } catch (e) {
      log(`${r.slug}: ${e.message}`);
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(summary, null, 2));
