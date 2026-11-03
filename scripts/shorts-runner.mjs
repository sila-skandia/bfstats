#!/usr/bin/env node
// Replay Shorts render job (features/replay-shorts): finds the kills worth a
// Short in the newest shared recordings, films each one on the live replay page
// in the creator's Shorts look, and uploads it to the Shorts API.
//
//   node scripts/shorts-runner.mjs [--recordings=6] [--recording=<slug>]... [--max=3]
//        [--api=https://bfstats.io] [--play=https://play.bfstats.io]
//        [--out=~/.cache/bfstats-shorts] [--upload] [--to=<api>] [--gpu|--swiftshader]
//        [--refilm-live] [--real-time] [--override=<viewer file>] [--real-view=pov|chase|front|flyby] [--sound] [--kill=<t>:<victim>]...
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
/** --refilm-live: film every live Short's kill again (a new look, sound, the
 *  real-time part) and replace it: the old one deleted just before the new one
 *  goes up, so the strip is never short for long. Implies --upload. */
const REFILM = args.includes('--refilm-live');
const UPLOAD = FILMED || REFILM || args.includes('--upload');
/** Sound (--sound): the page's audio rendered offline in step with the frames. */
const SOUND = args.includes('--sound');
/** The offline audio's rate: 1/30 s is 1280 samples, ten render quanta, so a
 *  frame's audio ends exactly where a suspend can stop the render. */
const AUDIO_RATE = 38400;
/** Seconds of audio one page load can render, every Short of it together. */
const AUDIO_SPAN = 300;
/** After the edit, the kill again in real time (--real-time). Off by default:
 *  the game's chase camera points the way the killer faces, not where he
 *  shoots, so it missed the hit (a Pak's on a Stuka, 2026-11-03). */
const REAL_TIME = args.includes('--real-time');
/** Local viewer files served in place of the live ones (--override=<path>,
 *  more than once): to film with a viewer change before it is deployed. */
const OVERRIDES = many('override');
const KEY = process.env.SHORTS_UPLOAD_KEY ?? '';
const W = 1080, H = 1920, FPS = 30;
const MAX_FRAMES = 60 * FPS;
const LOAD_TIMEOUT = 8 * 60 * 1000;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

if (UPLOAD && !KEY) {
  console.error('--upload needs SHORTS_UPLOAD_KEY');
  process.exit(2);
}

/** fetch, tried again on a network failure (not on an HTTP error): four times
 *  over about half a minute. A blip once failed every recording left in a
 *  run (2026-11-03). */
async function fetchRetry(url, init) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (i >= 3) throw e;
      log(`  ${e.message} (${url.split('?')[0]}), again in ${5 * 2 ** i} s`);
      await new Promise(r => setTimeout(r, 5000 * 2 ** i));
    }
  }
}

async function json(url) {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Every live Short, `Map<recording slug, ShortDto[]>` (the last 60 days). */
async function liveShorts() {
  const byRec = new Map();
  for (let page = 1; ; page++) {
    const res = await json(`${TO}/stats/shorts?days=60&pageSize=48&page=${page}`);
    for (const s of res.items) byRec.set(s.recordingSlug, [...(byRec.get(s.recordingSlug) ?? []), s]);
    if (page * res.pageSize >= res.total) break;
  }
  return byRec;
}
const LIVE = REFILM ? await liveShorts() : null;

/** The recordings to look at: those named, else the newest (or, re-filming,
 *  those the live Shorts came from). */
async function recordingsToDo() {
  // --recording narrows a re-film to those recordings (one resumed after a
  // failure); --skip-recording leaves some out.
  const only = new Set(many('recording'));
  const skip = new Set(many('skip-recording'));
  if (LIVE) {
    const slugs = [...LIVE.keys()].filter(s => (!only.size || only.has(s)) && !skip.has(s));
    return Promise.all(slugs.map(s => json(`${API}/stats/recordings/${s}`)));
  }
  const named = many('recording');
  if (named.length) return Promise.all(named.map(s => json(`${API}/stats/recordings/${s}`)));
  const page = await json(`${API}/stats/recordings?page=1&pageSize=${NEWEST}`);
  return page.items;
}

/** Kills of recording `slug` filmed before and turned down by hand: a folder
 *  under --out whose meta.json was renamed meta.rejected.json. Never filmed
 *  again. */
function rejectedKeys(slug) {
  const dir = path.join(OUT, slug);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(k => path.join(dir, k, 'meta.rejected.json')).filter(f => fs.existsSync(f))
    .map(f => JSON.parse(fs.readFileSync(f, 'utf8'))).map(m => P.shortKey(m.recordingSlug, m.killTime, m.victimPid));
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
  for (const file of OVERRIDES) {
    const name = path.basename(file);
    await page.route(u => new URL(u).pathname.endsWith(`/${name}`), r => r.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript' }));
  }
  if (SOUND) await page.addInitScript(({ rate, span }) => {
    // The page's AudioContext (three's AudioListener makes it) as an
    // OfflineAudioContext that renders only when the runner steps it: each
    // frame renders its 1/30 s, so every sound lands on its frame whatever the
    // frame took to draw. It says it is running, as the page's gates ask.
    const Offline = window.OfflineAudioContext;
    const realResume = Offline.prototype.resume;
    const realSuspend = Offline.prototype.suspend;
    class SteppedAudio extends Offline {
      constructor() {
        super(2, Math.round(rate * span), rate);
        window.__audio = this;
        this.__t = 0;
        this.__done = null;
      }
      get state() { return 'running'; }
      resume() { return Promise.resolve(); }
      suspend(t) { return t === undefined ? Promise.resolve() : realSuspend.call(this, t); }
      close() { return Promise.resolve(); }
    }
    window.AudioContext = SteppedAudio;
    window.webkitAudioContext = SteppedAudio;
    window.__audioT = () => window.__audio?.__t ?? null;
    window.__audioStep = async sec => {
      const a = window.__audio;
      if (!a || a.__t + sec > span - 1) return;
      const next = Math.round((a.__t + sec) * rate) / rate;
      const reached = realSuspend.call(a, next);
      if (!a.__done) a.__done = a.startRendering();
      else realResume.call(a);
      await reached;
      a.__t = next;
    };
    // The rendered audio of `ranges` ([[t0, t1], ...] per Short, joined), each
    // as a 16-bit stereo WAV, base64. Renders the rest of the span first: an
    // offline render gives its buffer only at its end.
    window.__audioWavs = async shorts => {
      const a = window.__audio;
      if (!a?.__done) return shorts.map(() => null);
      realResume.call(a);
      const buf = await a.__done;
      const L = buf.getChannelData(0);
      const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
      return shorts.map(ranges => {
        const spans = ranges.map(([t0, t1]) => [Math.round(t0 * rate), Math.round(t1 * rate)]);
        const n = spans.reduce((s, [a0, a1]) => s + (a1 - a0), 0);
        const out = new DataView(new ArrayBuffer(44 + n * 4));
        const str = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
        str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt ');
        out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
        out.setUint32(24, rate, true); out.setUint32(28, rate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
        str(36, 'data'); out.setUint32(40, n * 4, true);
        let o = 44;
        for (const [a0, a1] of spans) {
          for (let i = a0; i < a1; i++) {
            out.setInt16(o, Math.max(-1, Math.min(1, L[i] ?? 0)) * 32767, true);
            out.setInt16(o + 2, Math.max(-1, Math.min(1, R[i] ?? 0)) * 32767, true);
            o += 4;
          }
        }
        const bytes = new Uint8Array(out.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      });
    };
  }, { rate: AUDIO_RATE, span: AUDIO_SPAN });
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
    window.replay.creator.grant(true);
    // Everything the page started while it loaded starts at the audio's 0:
    // render it away before the first Short.
    await window.__audioStep?.(3);
  });
  return page;
}

/** The creator on, in the studio's Shorts recipe (9:16, grade, lower third,
 *  flash, freeze). Again before each Short: the real-time part turns it off,
 *  and off clears its look. */
async function armCreator(page) {
  await page.evaluate(async () => {
    const c = window.replay.creator;
    c.toggle(true);
    const { RECIPES, applyRecipe } = await import(new URL('replay-studio.js', location.href).href);
    const [, , , edits, frame] = RECIPES.find(([id]) => id === 'shorts');
    c.prefs.frame = frame;
    // The Shorts recipe less its kill effects: the punch zoom, the shake and
    // the white flash hid the kill they were meant to sell (the owner,
    // 2026-11-03: "obnoxious ... hard to understand what happened").
    c.edits = applyRecipe(c.edits, { ...edits, punch: false, shake: false, flash: false });
    c.syncFrame?.();
  });
}

/** Seconds of the round the real-time part shows before the kill and after
 *  it, at 1x. */
const REAL_BEFORE = 5;
const REAL_AFTER = 2.5;

/** The real-time camera for a kill: the game's chase camera (F10), behind an
 *  aircraft or a tank or over a man's shoulder. The owner asked for his own
 *  view from a tank (2026-11-03), but in 9:16 the replay's seat view is a
 *  letterboxed sight band with the gun off to one side and the target out of
 *  frame (the Tiger's kill on the M36), so tanks take the chase too until
 *  that view suits a tall frame. --real-view=pov forces it. */
export function realView() {
  return 'chase';
}

/** The kill again in real time after the edit, unedited: the creator off, the
 *  replay's own camera on the killer (`view`), REAL_BEFORE seconds before the
 *  kill to REAL_AFTER after, a small REAL TIME tag in the corner. Frames are
 *  written on from `n`; returns how many it wrote. */
async function filmRealTime(page, cand, kill, view, frames, n) {
  await page.evaluate(({ kill, killer, view, before }) => {
    const r = window.replay;
    r.creator.toggle(false);
    r.seek(Math.max(0, kill - before - 0.5));
    r.speed = 1;
    r.playing = true;
    if (r.ui?.follow) r.ui.follow(killer);
    else r.follow(killer);
    if (r.ui?.setMode) r.ui.setMode(view);
    else r.camera.setMode(view);
  }, { kill, killer: cand.killer, view, before: REAL_BEFORE });
  // A seat's view loads its cockpit model in real time; give it a moment, then
  // let the bodies a seek put down settle for half a second of the round.
  await page.waitForTimeout(2500);
  for (let i = 0; i < 15; i++) {
    await page.evaluate(async ({ W, H, FPS }) => {
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
    }, { W, H, FPS });
  }
  const count = Math.round((REAL_BEFORE + REAL_AFTER) * FPS);
  const audioFrom = await page.evaluate(() => window.__audioT?.() ?? null);
  for (let i = 0; i < count; i++) {
    const url = await page.evaluate(async ({ W, H, FPS }) => {
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
      const cv = (window.__realCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
      const g = cv.getContext('2d');
      g.drawImage(window.__renderer.domElement, 0, 0, W, H);
      const label = 'REAL TIME';
      g.font = '700 30px system-ui, "Segoe UI", sans-serif';
      const w = g.measureText(label).width + 44;
      g.fillStyle = 'rgba(12, 12, 10, 0.62)';
      g.beginPath();
      g.roundRect(44, 96, w, 52, 26);
      g.fill();
      g.fillStyle = '#d23b2f';
      g.beginPath();
      g.arc(66, 122, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f2ecd8';
      g.textBaseline = 'middle';
      g.fillText(label, 82, 123);
      return cv.toDataURL('image/jpeg', 0.92);
    }, { W, H, FPS });
    fs.writeFileSync(path.join(frames, `f${String(n + i).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  }
  return { count, audio: audioFrom === null ? null : [audioFrom, audioFrom + count / FPS] };
}

/** One Short filmed into `dir`: frames, then the MP4 and its poster. */
async function film(page, cand, dir, view = null) {
  await armCreator(page);
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
  let audioFrom = null;
  for (let i = 0; i < MAX_FRAMES; i++) {
    const res = await page.evaluate(async ({ W, H, FPS }) => {
      const at = window.__audioT?.() ?? null;
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
      const c = window.replay.creator;
      const rec = c.recorder;
      const out = { rec: Boolean(rec), state: c.rounds?.state ?? null, at };
      if (rec?.started) out.url = (rec.source ?? window.__renderer.domElement).toDataURL('image/jpeg', 0.92);
      return out;
    }, { W, H, FPS });
    if (res.url) {
      if (n === 0) audioFrom = res.at;
      fs.writeFileSync(path.join(frames, `f${String(n).padStart(4, '0')}.jpg`), Buffer.from(res.url.split(',')[1], 'base64'));
      if (hitFrame === null && res.state === 'impact') hitFrame = n;
      n++;
    }
    if (!res.rec && n > 0) break;
  }
  if (n < FPS) return { ok: false, why: `only ${n} frames` };
  const edited = n;
  const audio = audioFrom === null ? null : [[audioFrom, audioFrom + edited / FPS]];
  if (view) {
    const real = await filmRealTime(page, cand, setup.kill, view, frames, n);
    n += real.count;
    if (audio && real.audio) audio.push(real.audio);
  }
  const mp4 = path.join(dir, 'short.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.jpg'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-maxrate', '12M', '-bufsize', '24M',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  const at = posterFrame(frames, n, hitFrame);
  const poster = path.join(dir, 'poster.jpg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(frames, `f${String(at).padStart(4, '0')}.jpg`),
    '-vf', 'scale=540:960', '-q:v', '4', poster]);
  fs.rmSync(frames, { recursive: true, force: true });
  return { ok: true, mp4, poster, audio, frames: n, edited, lengthSeconds: Math.round((n / FPS) * 10) / 10, names: setup.names };
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

/** Each Short's soundtrack muxed into its MP4: the page's offline audio
 *  rendered to its end, the Short's stretches of it cut out (the edit's and
 *  the real time's), AAC at 48 kHz. A Short without audio stays silent. */
async function addSound(page, done) {
  const wavs = await page.evaluate(ranges => window.__audioWavs(ranges), done.map(d => d.made.audio ?? []));
  done.forEach(({ made, dir }, i) => {
    if (!wavs[i]) return;
    const wav = path.join(dir, 'sound.wav');
    fs.writeFileSync(wav, Buffer.from(wavs[i], 'base64'));
    const silent = path.join(dir, 'silent.mp4');
    fs.renameSync(made.mp4, silent);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest', '-movflags', '+faststart', made.mp4]);
    fs.rmSync(silent);
    log(`  sound added to ${path.basename(dir)}`);
  });
}

async function remove(slug) {
  const res = await fetchRetry(`${TO}/stats/shorts/${slug}`, { method: 'DELETE', headers: { 'X-Shorts-Key': KEY } });
  if (!res.ok && res.status !== 404) throw new Error(`delete ${slug}: ${res.status}`);
  log(`  replaced ${slug}`);
}

async function upload(meta, made) {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  form.append('video', new Blob([fs.readFileSync(made.mp4)], { type: 'video/mp4' }), 'short.mp4');
  form.append('poster', new Blob([fs.readFileSync(made.poster)], { type: 'image/jpeg' }), 'poster.jpg');
  const res = await fetchRetry(`${TO}/stats/shorts`, { method: 'POST', body: form, headers: { 'X-Shorts-Key': KEY } });
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
      const res = await fetchRetry(`${API}${r.recordingUrl}`);
      if (!res.ok) throw new Error(`recording ${res.status}`);
      const rec = R.parseRecording(await res.text());
      // A failed download parses as an empty round: never judge Shorts by it
      // (2026-11-03, a run took down three good Shorts on one).
      if (!rec.kills?.length) throw new Error('the recording has no kills: not read whole');
      const models = modelsOf(r.mod);
      const cands = P.shortCandidates(rec, { models, slug: r.slug });
      const keys = await json(`${TO}/stats/shorts/keys?recording=${r.slug}`).then(k => new Set(k.keys)).catch(() => new Set());
      for (const k of rejectedKeys(r.slug)) keys.add(k);
      // --kill=<t>:<victim> films that kill whatever was clipped before (a re-do).
      const only = LIVE ? LIVE.get(r.slug).map(s => [s.killTime, s.victimPid]) : many('kill').map(k => k.split(':').map(Number));
      const picks = only.length
        ? cands.filter(c => only.some(([t, v]) => Math.abs(c.t - t) < 0.05 && c.victim === v))
        : P.pickShorts(cands, { max: MAX, taken: keys });
      log(`${r.slug} ${r.level} (${r.mod}): ${cands.length} candidates, ${picks.length} to film`);
      // Re-filming: a live Short whose kill the picker no longer passes (out of
      // the recorder's range, a hop) comes down.
      if (LIVE && UPLOAD && cands.length) {
        for (const old of LIVE.get(r.slug)) {
          if (!picks.some(c => P.shortKey(r.slug, c.t, c.victim) === old.key)) {
            await remove(old.slug);
            log(`  took down "${old.title}": the picker no longer passes it`);
          }
        }
      }
      if (!picks.length) continue;
      const page = await openPage(browser, playUrl(r));
      const done = [];
      try {
        for (const c of picks) {
          const dir = path.join(OUT, r.slug, `${c.t.toFixed(2)}-${c.victim}`);
          fs.mkdirSync(dir, { recursive: true });
          const t0 = Date.now();
          const made = await film(page, c, dir, REAL_TIME ? (opt('real-view', null) ?? realView(c)) : null);
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
          done.push({ c, meta, made, dir });
        }
        if (SOUND && done.some(d => d.made.audio)) await addSound(page, done);
      } finally {
        await page.close();
      }
      for (const { c, meta, made, dir } of done) {
        let slug = null;
        if (UPLOAD) {
          const old = LIVE?.get(r.slug)?.find(s => s.key === P.shortKey(r.slug, meta.killTime, meta.victimPid));
          if (old) await remove(old.slug);
          const short = await upload(meta, made);
          slug = short.slug;
          log(`  uploaded ${slug} "${meta.title}"`);
        }
        summary.push({ recording: r.slug, title: meta.title, kind: c.kind, dir, slug });
      }
    } catch (e) {
      log(`${r.slug}: ${e.message}`);
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(summary, null, 2));
