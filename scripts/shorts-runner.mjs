#!/usr/bin/env node
// Replay Shorts render job (features/replay-shorts): finds the kills worth a
// Short in the newest shared recordings, films each one on the live replay page
// in the creator's Shorts look, and uploads it to the Shorts API.
//
//   node scripts/shorts-runner.mjs [--recordings=6] [--recording=<slug>]... [--max=3]
//        [--api=https://bfstats.io] [--play=https://play.bfstats.io]
//        [--out=~/.cache/bfstats-shorts] [--upload] [--to=<api>] [--gpu|--swiftshader]
//        [--reels] [--kinds=own-goal,player,...] [--refilm-live] [--real-time] [--override=<viewer file>] [--real-view=pov|chase|front|flyby] [--sound] [--kill=<t>:<victim>]...
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
const [R, P, VP] = await Promise.all([imp('replay-recording.js'), imp('replay-shorts-pick.js'), imp('vehicle-players.js')]);
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

// --- guards (the owner, 2026-11-03: "add guards to the expected time, and
// intervene when stuck"; a run once sat 27 min on a page that never loaded) --
/** One step in the page (a frame, a seek, the sound's render) may take this
 *  long; past it the step fails and the recording is abandoned. */
const STEP_TIMEOUT = 45 * 1000;
/** One recording, load to sound, may take this long in all. */
const RECORDING_BUDGET = 25 * 60 * 1000;
/** --trace writes each kill shot's round against its victim, per frame, to
 *  OUT/trace-<t>-<victim>.json. */
const TRACE = args.includes('--trace');
const traceLog = [];
/** A promise that rejects after `ms`, naming `what`. */
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took over ${Math.round(ms / 1000)} s`)), ms);
  })]).finally(() => clearTimeout(timer));
}
/** What the runner is doing and how many frames it has written: the
 *  heartbeat logs both every 30 s, so a watcher can tell a stall from work. */
let phase = 'starting';
let framesWritten = 0;
const heartbeat = setInterval(() => log(`heartbeat: ${phase}, ${framesWritten} frames written`), 30 * 1000);
heartbeat.unref();
/** The browser's processes are this runner's children: kill them outright
 *  when a page hangs or the runner is stopped, so none is left on the GPU. */
function killBrowser() {
  // Every process under this one, deepest first (Chromium's GPU and renderer
  // processes are the browser's children, not ours).
  const tree = [];
  const walk = pid => {
    let kids = [];
    try { kids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* none */ }
    for (const k of kids) {
      walk(k);
      tree.push(k);
    }
  };
  walk(process.pid);
  for (const pid of tree) {
    try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ }
  }
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    log(`stopped (${sig})`);
    killBrowser();
    process.exit(143);
  });
}

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
    // Compilations and reels (a victim below 0) are not one kill: a re-film by
    // kill leaves them alone (one was taken down as "no longer passing").
    for (const s of res.items) if (s.victimPid >= 0) byRec.set(s.recordingSlug, [...(byRec.get(s.recordingSlug) ?? []), s]);
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

/** The weapons that eject their clip with a ping (the M1 Garand), from the
 *  tree's sound table: the mod's own, else vanilla's. */
function ejectsOf(mod) {
  const own = path.join(VIEWER, 'models/mods', String(mod).toLowerCase(), 'sounds/weapons.json');
  const file = fs.existsSync(own) ? own : path.join(VIEWER, 'models/sounds/weapons.json');
  try {
    const table = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows = table.weapons ?? table;
    return Object.entries(rows).filter(([, v]) => v?.eject).map(([k]) => k);
  } catch {
    return ['M1Garand'];
  }
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
  // Every step in the page is bounded (STEP_TIMEOUT).
  const evaluate = page.evaluate.bind(page);
  page.evaluate = (fn, arg) => withTimeout(evaluate(fn, arg), STEP_TIMEOUT, 'a page step');
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
async function armCreator(page, { lower = true } = {}) {
  await page.evaluate(async lower => {
    const c = window.replay.creator;
    c.toggle(true);
    const { RECIPES, applyRecipe } = await import(new URL('replay-studio.js', location.href).href);
    const [, , , edits, frame] = RECIPES.find(([id]) => id === 'shorts');
    c.prefs.frame = frame;
    // The Shorts recipe less its kill effects: the punch zoom, the shake and
    // the white flash hid the kill they were meant to sell (the owner,
    // 2026-11-03: "obnoxious ... hard to understand what happened").
    // The freeze on the kill goes too (2026-11-04): it held the frame still at
    // the hit for half a second, so the explosion came after the round as if
    // late.
    c.edits = applyRecipe(c.edits, { ...edits, punch: false, shake: false, flash: false, freeze: 0 });
    // In a compilation the player's name is on top already: no lower third,
    // and two seconds before each shot rather than three (six kills ran a
    // minute).
    // A compilation's parts end in the runner's own dip (DIP), not the look's fade.
    if (!lower) c.edits = { ...c.edits, lower: { ...c.edits.lower, on: false }, fadeOut: 0 };
    c.prefs.leadIn = lower ? 3 : 2;
    // After the hold the camera stays where it is (2026-11-04): handed to the
    // man it killed, it flew across the map to wherever he had respawned for
    // the clip's last half second.
    c.prefs.afterHit = 'stay';
    c.rounds.afterHit = 'stay';
    c.syncFrame?.();
  }, lower);
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

/** A reel's beats (the owner, 2026-11-03: own goals and spawn deaths one at
 *  a time were "too quick" and WASTED "too forced"; "the clips are great ...
 *  the way they fade ... put them into a compilation"):
 *  - `lead`: seconds of the round shown before an own goal, at 1x (a spawn
 *    death is shown from his spawn);
 *  - after the death the clock runs at `slow` for `hold` seconds of video,
 *    the picture drains to grey over `grey` and fades to black over `fade`;
 *  - the camera then stands back from where he died: `man` / `hull` [metres
 *    back, up] for an own goal, looking down at it (from 4 m up a wall hid
 *    the body), or `behind` / `up` behind a spawn death's body, looking
 *    toward his killer, so the viewer sees who did it. */
/** Pixels the name, the "3 of 6" and the life clock sit below the top of the
 *  frame beyond where they were first drawn: the strip's card puts its kind
 *  badge over the top ~175 px of the poster, and it hid the player's name
 *  (the owner, 2026-11-04). */
const OVERLAY_TOP = 160;

/**
 * The streak's running count, drawn under the player's name in the page
 * (`window.__streakBadge(g, W, y, before, after, since)`): "N KILL STREAK"
 * showing the count before this kill until the hit, then the new count
 * sliding up into place over STREAK_TICK frames (`since`, frames past the hit;
 * negative before it). No punch, no flash (the owner's reviews).
 */
const STREAK_TICK = 6;

/**
 * A scene is clean when the man being killed is in the picture (inside the
 * middle 90% of it) and nothing of the level stands between the camera and
 * him (the owner, 2026-11-04: a tank's six kills from inside a hangar, all
 * of them behind its walls). `share` of a take's kills must be. The page's
 * test, `window.__clean(pid, t)`, casts the level's collider (terrain and
 * statics) from the camera to his chest.
 */
const CLEAN = Object.freeze({ share: 0.6, margin: 0.9, chest: 1.1, slack: 1.5 });
const CLEAN_TEST = `window.__clean = (pid, t) => {
  const r = window.replay;
  const cam = r.ctx.camera;
  const w = window.__rbSync?.whereIs(r.rec, pid, t, r.kills ?? r.rec.kills);
  if (!w?.pos) return false;
  const p = cam.position.clone().set(w.pos[0], w.pos[1] + ${CLEAN.chest}, w.pos[2]);
  const ndc = p.clone().project(cam);
  if (!(ndc.z < 1) || Math.abs(ndc.x) > ${CLEAN.margin} || Math.abs(ndc.y) > ${CLEAN.margin}) return false;
  const collider = r.ctx.guns?.collider;
  if (!collider?.cast) return true;
  const d = p.clone().sub(cam.position);
  const dist = d.length();
  if (dist < 2) return true;
  d.divideScalar(dist);
  const hit = collider.cast(cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z, dist - ${CLEAN.slack}, -1, 0, 0);
  return !hit;
};`;
const STREAK_BADGE = `window.__streakBadge = (g, W, y, before, after, since, word = 'KILL STREAK') => {
  const tick = ${STREAK_TICK};
  const draw = (n, dy, alpha) => {
    if (!(n > 0) || alpha <= 0) return;
    g.save();
    g.globalAlpha = alpha;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const big = String(n);
    g.font = '900 76px system-ui, "Segoe UI", sans-serif';
    const wn = g.measureText(big).width;
    g.font = '800 34px system-ui, "Segoe UI", sans-serif';
    const wl = g.measureText(word).width;
    const w = wn + wl + 72;
    g.fillStyle = 'rgba(12,12,10,0.66)';
    g.beginPath();
    g.roundRect(W / 2 - w / 2, y - 50 + dy, w, 100, 20);
    g.fill();
    g.fillStyle = '#e2793f';
    g.fillRect(W / 2 - w / 2 + 14, y - 34 + dy, 6, 68);
    g.font = '900 76px system-ui, "Segoe UI", sans-serif';
    g.fillStyle = '#f6f1e2';
    g.fillText(big, W / 2 - w / 2 + 34 + wn / 2, y + 4 + dy);
    g.font = '800 34px system-ui, "Segoe UI", sans-serif';
    g.fillStyle = '#e2793f';
    g.fillText(word, W / 2 - w / 2 + 50 + wn + wl / 2, y + 4 + dy);
    g.restore();
  };
  if (since < 0) return draw(before, 0, 1);
  const k = Math.min(1, since / tick);
  const e = k * k * (3 - 2 * k);
  draw(before, -60 * e, 1 - e);
  draw(after, 60 * (1 - e), e);
};`;

/**
 * A burst is filmed in one take behind its player (the owner, 2026-11-04:
 * "limit it to a certain time, and if it exceeds a threshold speed it up"):
 * the clock runs at a base speed that fits it in about `cap` seconds of
 * video (1x to `maxSpeed`), easing over `ease` seconds of round to `slow`
 * from `before` a kill to `after` it, so each kill lands in slow motion.
 */
const BURST_PACE = Object.freeze({ cap: 30, maxSpeed: 4, slow: 0.4, before: 0.25, after: 0.45, ease: 0.25, fade: 10 });

/**
 * Between a compilation's parts (features/replay-shorts/EDITS.md, the dip):
 * the last `ramp` frames before the dip play at about 1.5x (every third
 * dropped), then `out` frames go to black, and the next part comes up from
 * black over `in`. Half a second where the look's fade out and the old fade
 * in took over a second of near-black.
 */
const DIP = Object.freeze({ ramp: 10, out: 6, in: 6 });

/** The cold open: COLD.before frames before a compilation's best hit to
 *  COLD.after after it, copied to the front and dipped to black, its sound in
 *  front of the rest. Returns the new frame count. */
const COLD = Object.freeze({ before: 6, after: 39 });
async function coldOpen(page, frames, n, marks, audio) {
  const best = marks.reduce((a, m) => (m.score > a.score ? m : a), marks[0]);
  const s0 = Math.max(best.start, best.hit - COLD.before);
  const s1 = Math.min(best.end, best.hit + COLD.after + 1);
  const k = s1 - s0;
  if (k < FPS) return n;
  const name = i => path.join(frames, `f${String(i).padStart(4, '0')}.jpg`);
  const copied = [];
  for (let i = s0; i < s1; i++) copied.push(`data:image/jpeg;base64,${fs.readFileSync(name(i)).toString('base64')}`);
  for (let i = n - 1; i >= 0; i--) fs.renameSync(name(i), name(i + k));
  const out = await dipOut(page, copied);
  out.frames.forEach((url, i) => fs.writeFileSync(name(i), Buffer.from(url.split(',')[1], 'base64')));
  // Frames the dip's ramp dropped close the gap they leave.
  const made = out.frames.length;
  if (made < k) for (let i = k; i < n + k; i++) fs.renameSync(name(i), name(i - (k - made)));
  const from = best.audioFrom + (s0 - best.start) / FPS;
  audio.unshift([from, from + made / FPS]);
  log(`    cold open: ${made} frames of the best hit`);
  return n + made;
}

/** The map card between two kills `gap` seconds or more apart: `frames`
 *  long, faded over `fade`, the route drawn from `drawFrom` to `drawTo`. */
const MAP_CARD = Object.freeze({ gap: 20, frames: 30, fade: 4, drawFrom: 4, drawTo: 24, samples: 48 });
async function mapCard(page, reel, a, b) {
  return page.evaluate(async ({ W, H, pid, t0, t1, card, name, top }) => {
    const r = window.replay;
    const B = (window.__rb ??= await import(new URL('replay-battles.js', location.href).href));
    // The level's map art and its projection, from the scene the page loaded.
    if (!window.__mapCard) {
      // The level's scene, where the page reads its maps from.
      const q = new URLSearchParams(location.search);
      const mod = (q.get('mod') || 'bf1942').toLowerCase();
      const sceneUrl = new URL(`maps/${mod === 'bf1942' ? '' : `mods/${mod}/`}${q.get('map')}/scene.json`, location.href).href;
      const scene = await fetch(sceneUrl).then(x => x.json());
      const mm = (scene.extras ?? scene).minimap;
      if (!mm?.image || !mm.worldToImage) return null;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = new URL(mm.image, sceneUrl).href;
      await img.decode();
      window.__mapCard = { img, m: mm.worldToImage };
    }
    const { img, m } = window.__mapCard;
    const route = [];
    for (let i = 0; i <= card.samples; i++) {
      const t = t0 + ((t1 - t0) * i) / card.samples;
      const w = B.whereIs(r.rec, pid, t, r.kills ?? r.rec.kills);
      if (w?.pos) route.push([m[0] * w.pos[0] + m[1] * w.pos[2] + m[2], m[3] * w.pos[0] + m[4] * w.pos[2] + m[5]]);
    }
    if (route.length < 2) return null;
    // Framed on the route: the map zoomed to it, at least a third of the map.
    const us = route.map(p => p[0]);
    const vs = route.map(p => p[1]);
    const cu = (Math.min(...us) + Math.max(...us)) / 2;
    const cv0 = (Math.min(...vs) + Math.max(...vs)) / 2;
    const span = Math.min(1, Math.max(0.34, (Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs))) * 1.6));
    const size = W - 120;
    const x0 = (W - size) / 2;
    const y0 = (H - size) / 2 + 60;
    const toXY = ([u, v]) => [x0 + ((u - (cu - span / 2)) / span) * size, y0 + ((v - (cv0 - span / 2)) / span) * size];
    const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = cv.getContext('2d');
    const V = (window.__vp ??= await import(new URL('vehicle-players.js', location.href).href));
    const shown = V.decodePlayerName ? V.decodePlayerName(name) : name;
    const gap = Math.round(t1 - t0);
    const label = `+${Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')}`;
    const out = [];
    for (let f = 0; f < card.frames; f++) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      g.save();
      g.beginPath();
      g.roundRect(x0, y0, size, size, 18);
      g.clip();
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      g.globalAlpha = 0.85;
      g.drawImage(img, (cu - span / 2) * iw, (cv0 - span / 2) * ih, span * iw, span * ih, x0, y0, size, size);
      g.globalAlpha = 1;
      // The route so far, and where he is on it.
      const k = Math.max(0, Math.min(1, (f - card.drawFrom) / (card.drawTo - card.drawFrom)));
      const upto = Math.max(1, Math.round(k * (route.length - 1)));
      g.lineWidth = 9;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(232,195,90,0.95)';
      g.beginPath();
      route.slice(0, upto + 1).forEach((p, i) => { const [x, y] = toXY(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
      const [sx, sy] = toXY(route[0]);
      g.fillStyle = '#f6f1e2';
      g.beginPath();
      g.arc(sx, sy, 12, 0, Math.PI * 2);
      g.fill();
      const [ex, ey] = toXY(route[upto]);
      g.fillStyle = '#e2793f';
      g.beginPath();
      g.arc(ex, ey, 16, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.strokeStyle = 'rgba(246,241,226,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(x0, y0, size, size, 18);
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '800 64px system-ui, "Segoe UI", sans-serif';
      const w = g.measureText(shown).width + 64;
      g.fillStyle = 'rgba(12,12,10,0.62)';
      g.beginPath();
      g.roundRect(W / 2 - w / 2, 152 + top, w, 96, 48);
      g.fill();
      g.fillStyle = '#f6f1e2';
      g.fillText(shown, W / 2, 202 + top);
      g.font = '900 72px system-ui, "Segoe UI", sans-serif';
      g.fillStyle = '#e8c35a';
      g.fillText(label, W / 2, y0 - 70);
      const fadeIn = Math.min(1, (f + 1) / card.fade);
      const fadeOut = Math.min(1, (card.frames - f) / card.fade);
      const a = Math.min(fadeIn, fadeOut);
      if (a < 1) {
        g.fillStyle = `rgba(0,0,0,${1 - a})`;
        g.fillRect(0, 0, W, H);
      }
      out.push(cv.toDataURL('image/jpeg', 0.9));
    }
    return out;
  }, { W, H, pid: reel.player, t0: a.t, t1: b.t, card: MAP_CARD, name: reel.playerName ?? '', top: OVERLAY_TOP });
}

/** Each part's sound starts JCUT frames before its picture, under the last
 *  of the dip before it (EDITS.md, the J-cut). */
const JCUT = 8;
function jCut(audio) {
  for (let i = 1; i < audio.length; i++) {
    const lead = JCUT / FPS;
    if (audio[i - 1][1] - audio[i - 1][0] < 1 || audio[i][1] - audio[i][0] < 1) continue;
    audio[i][0] -= lead;
    audio[i - 1][1] -= lead;
  }
}

/** A part's frames out through the dip: `{ frames, dropped }`. */
async function dipOut(page, urls) {
  if (urls.length < DIP.ramp + DIP.out + 4) return { frames: urls, dropped: 0 };
  const head = urls.slice(0, urls.length - DIP.ramp - DIP.out);
  const ramp = urls.slice(urls.length - DIP.ramp - DIP.out, urls.length - DIP.out).filter((_, i) => i % 3 !== 2);
  const dropped = DIP.ramp - ramp.length;
  const tail = await page.evaluate(async ({ urls, W, H }) => {
    const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = cv.getContext('2d');
    const out = [];
    for (const [i, url] of urls.entries()) {
      const img = new Image();
      img.src = url;
      await img.decode();
      g.drawImage(img, 0, 0, W, H);
      const k = (i + 1) / urls.length;
      g.fillStyle = `rgba(0,0,0,${k * k * (3 - 2 * k)})`;
      g.fillRect(0, 0, W, H);
      out.push(cv.toDataURL('image/jpeg', 0.92));
    }
    return out;
  }, { urls: urls.slice(urls.length - DIP.out), W, H });
  return { frames: [...head, ...ramp, ...tail], dropped };
}

/** Seconds the streak's closing card holds, after its fade in. */
const STREAK_CARD = 2.2;

const REEL_BEAT = Object.freeze({
  top: OVERLAY_TOP,
  lead: 4, slow: 0.35, hold: 1.8, grey: 0.4, fade: 0.35, volleyLead: 5, volleyHold: 3.2, playerLead: 3.5, playerHold: 2.2,
  // A volley stays behind the killer through the kill: the clock eases from
  // 1x to volleySlow over the volleyEase seconds of round before it, so the
  // last rounds of the burst fly slowly as the kill lands, and the lens
  // widens (up to volleyFov degrees) only when his victim would leave the
  // frame's middle volleyFit of it.
  volleySlow: 0.3, volleyEase: 0.7, volleyFov: 80, volleyFit: 0.8,
  // When the victim sits behind the killer's own plane on screen (dead ahead
  // on the chase line), the eye rises volleyLift metres, eased over
  // volleyLiftTime seconds, and stays up for the part.
  volleyLift: 3, volleyLiftTime: 0.4,
  man: [6, 8], hull: [26, 9], behind: 5, up: 3.5,
});

/**
 * One ASMR moment (picker `asmrReelOf`): the game's chase camera behind its
 * shooter from `t0` to `t1` at 1x, the weapon's name small at the top, in
 * from black and out through the dip. Frames go to `write`; returns its
 * stretch of the sound.
 */
async function filmTake(page, part, write) {
  await page.evaluate(({ from, pid }) => {
    const r = window.replay;
    r.creator.toggle(false);
    r.seek(Math.max(0, from));
    r.speed = 1;
    r.playing = false;
    if (r.ui?.follow) r.ui.follow(pid);
    else r.follow(pid);
    if (r.ui?.setMode) r.ui.setMode('chase');
    else r.camera.setMode('chase');
  }, { from: part.t0, pid: part.pid });
  await page.waitForTimeout(1200);
  for (let k = 0; k < 20; k++) {
    await page.evaluate(async ({ W, H, FPS }) => {
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
    }, { W, H, FPS });
  }
  await page.evaluate(() => { window.replay.playing = true; });
  const caption = await page.evaluate(w => window.replay.creator.display?.(w) || w, part.weapon);
  let from = null;
  const held = [];
  for (let k = 0; k < MAX_FRAMES; k++) {
    const res = await page.evaluate(async ({ W, H, FPS, t1, caption, top, k, fade }) => {
      const r = window.replay;
      const at = window.__audioT?.() ?? null;
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
      const cv = (window.__reelCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
      const g = cv.getContext('2d');
      g.drawImage(window.__renderer.domElement, 0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '800 44px system-ui, "Segoe UI", sans-serif';
      g.fillStyle = 'rgba(246,241,226,0.9)';
      g.shadowColor = 'rgba(0,0,0,0.7)';
      g.shadowBlur = 12;
      g.fillText(String(caption).toUpperCase(), W / 2, 110 + top);
      g.shadowBlur = 0;
      if (k < fade) {
        g.fillStyle = `rgba(0,0,0,${1 - (k + 1) / (fade + 1)})`;
        g.fillRect(0, 0, W, H);
      }
      return { at, end: r.time >= t1, url: cv.toDataURL('image/jpeg', 0.92) };
    }, { W, H, FPS, t1: part.t1, caption, top: OVERLAY_TOP, k, fade: DIP.in });
    if (from === null) from = res.at;
    held.push(res.url);
    if (res.end) break;
  }
  const out = await dipOut(page, held);
  for (const url of out.frames) write(url);
  const to = await page.evaluate(() => window.__audioT?.() ?? null);
  return { audio: from !== null && to !== null ? [from, to - out.dropped / FPS] : null };
}

/**
 * A kill burst in one take (BURST_PACE): the game's chase camera behind its
 * player from BURST.lead before the first kill to BURST.tail after the last,
 * the clock fast between kills and slow on each, the count ticking on each
 * kill under his name, faded in and out. Frames go to `write`; returns the
 * take's stretch of the sound.
 */
async function filmBurst(page, reel) {
  const n = reel.killTimes.length;
  const roundSecs = reel.t1 - reel.t0;
  const slowSecs = n * (BURST_PACE.before + BURST_PACE.after);
  const base = Math.min(BURST_PACE.maxSpeed, Math.max(1,
    (roundSecs - slowSecs) / Math.max(8, BURST_PACE.cap - slowSecs / BURST_PACE.slow)));
  await page.evaluate(({ from, pid }) => {
    const r = window.replay;
    r.creator.toggle(false);
    r.seek(Math.max(0, from));
    r.speed = 1;
    r.playing = false;
    if (r.ui?.follow) r.ui.follow(pid);
    else r.follow(pid);
    if (r.ui?.setMode) r.ui.setMode('chase');
    else r.camera.setMode('chase');
  }, { from: reel.t0, pid: reel.player });
  await page.waitForTimeout(1200);
  for (let k = 0; k < 20; k++) {
    await page.evaluate(async ({ W, H, FPS }) => {
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
    }, { W, H, FPS });
  }
  await page.evaluate(() => { window.replay.playing = true; window.__burstLast = -1; window.__burstSeen = []; });
  let from = null;
  let frames = 0;
  const done = [];
  for (let k = 0; k < MAX_FRAMES; k++) {
    const res = await page.evaluate(async ({ W, H, FPS, kills, victims, t1, base, pace, name, top, k }) => {
      const r = window.replay;
      const at = window.__audioT?.() ?? null;
      // The clock: fast between kills, slow on each.
      let near = 0;
      for (const tk of kills) {
        const into = r.time - (tk - pace.before);
        const out = (tk + pace.after) - r.time;
        const edge = Math.min(into, out);
        const u = Math.max(0, Math.min(1, (edge + pace.ease) / pace.ease));
        near = Math.max(near, u * u * (3 - 2 * u));
      }
      r.speed = base + (pace.slow - base) * near;
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
      const count = kills.filter(tk => tk <= r.time).length;
      if (count > 0 && count - 1 > window.__burstLast) {
        window.__burstLast = count - 1;
        window.__burstHitAt = k;
        // Was the man just killed in the picture, and not behind a wall?
        window.__burstSeen.push(window.__clean?.(victims[count - 1], kills[count - 1]) ?? true);
      }
      const cv = (window.__reelCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
      const g = cv.getContext('2d');
      g.drawImage(window.__renderer.domElement, 0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const V = (window.__vp ??= await import(new URL('vehicle-players.js', location.href).href));
      const shown = V.decodePlayerName ? V.decodePlayerName(name) : name;
      g.font = '800 64px system-ui, "Segoe UI", sans-serif';
      const w = g.measureText(shown).width + 64;
      g.fillStyle = 'rgba(12,12,10,0.62)';
      g.beginPath();
      g.roundRect(W / 2 - w / 2, 152 + top, w, 96, 48);
      g.fill();
      g.fillStyle = '#f6f1e2';
      g.fillText(shown, W / 2, 202 + top);
      const since = count > 0 ? k - window.__burstHitAt : -1;
      window.__streakBadge(g, W, 310 + top, Math.max(0, count - 1), count, since, 'KILLS');
      // In from black and out to it.
      const end = r.time >= t1;
      return { at, end, time: r.time, url: cv.toDataURL('image/jpeg', 0.92) };
    }, { W, H, FPS, kills: reel.killTimes, victims: reel.parts.map(p => p.victim), t1: reel.t1, base, pace: BURST_PACE, name: reel.playerName, top: OVERLAY_TOP, k });
    if (from === null) from = res.at;
    done.push(res.url);
    frames++;
    if (res.end) break;
  }
  // The fades, drawn over the first and last frames in the page.
  const faded = await page.evaluate(async ({ urls, fade, W, H }) => {
    const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = cv.getContext('2d');
    const shade = async (url, a) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      g.drawImage(img, 0, 0, W, H);
      g.fillStyle = `rgba(0,0,0,${a})`;
      g.fillRect(0, 0, W, H);
      return cv.toDataURL('image/jpeg', 0.92);
    };
    const out = [];
    for (let i = 0; i < fade && i < urls.length; i++) out.push([i, await shade(urls[i], 1 - (i + 1) / (fade + 1))]);
    for (let i = 0; i < fade && i < urls.length; i++) {
      const j = urls.length - 1 - i;
      out.push([j, await shade(urls[j], 1 - (i + 1) / (fade + 1))]);
    }
    return out;
  }, { urls: [...done.slice(0, BURST_PACE.fade), ...done.slice(-BURST_PACE.fade)], fade: BURST_PACE.fade, W, H });
  // `faded` indexes the slice: map its tail back onto the take.
  for (const [i, url] of faded) {
    const j = i < BURST_PACE.fade ? i : done.length - (BURST_PACE.fade * 2 - i);
    if (j >= 0 && j < done.length) done[j] = url;
  }
  const to = await page.evaluate(() => { window.replay.speed = 1; return window.__audioT?.() ?? null; });
  const flags = await page.evaluate(() => window.__burstSeen ?? []);
  const seen = flags.length ? flags.filter(Boolean).length / flags.length : 0;
  log(`    burst taken at ${base.toFixed(2)}x between kills, ${frames} frames, ${Math.round(seen * 100)}% of its kills seen`);
  return { frames: done, seen, audio: from !== null && to !== null ? [from, to] : null };
}

/**
 * A round's own goals or spawn deaths as one reel: each part followed with
 * the game's chase camera (from his spawn, a life clock counting, for a spawn
 * death; REEL_BEAT.lead seconds before for an own goal), then at his death
 * the camera stands back, the clock slows, the picture drains to grey and
 * fades to black into the next. No captions beyond the clock and the count.
 */
/** A part's count on top: "3 of 4", and "3 of 4 - 2 kills" for one shot
 *  that killed two (`count`, the picker's same-moment merge). */
/** A streak part's count before its kill and after it. */
const streakCounts = (part, reel) => part.ending
  ? { before: reel.total, after: reel.total }
  : { before: part.streakIndex - (part.count ?? 1), after: part.streakIndex };
/** A streak part's line over the name: only its ending says anything. */
const streakLabel = (part, reel) => (part.ending ? `Ended by ${reel.endedByShown ?? reel.endedByName}` : null);

const partLabel = (i, n, part, reel = null) => {
  // A streak counts its kills: "Kill 12 of 25" ("Kills 21-22 of 25" for one
  // shot that killed two).
  if (reel?.streak) {
    const last = part.streakIndex;
    const first = last - (part.count ?? 1) + 1;
    return first < last ? `Kills ${first}-${last} of ${reel.total}` : `Kill ${last} of ${reel.total}`;
  }
  return `${i + 1} of ${n}${part.count > 1 ? ` - ${part.count} kills` : ''}`;
};

async function filmReel(page, reel, dir) {
  const frames = path.join(dir, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  let n = 0;
  const audio = [];
  const write = url => {
    fs.writeFileSync(path.join(frames, `f${String(n++).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    framesWritten++;
  };
  if (reel.streak || reel.burst) await page.evaluate(STREAK_BADGE);
  if (reel.burst) {
    await page.evaluate(async src => {
      window.__rbSync = await import(new URL('replay-battles.js', location.href).href);
      (0, eval)(src);
    }, CLEAN_TEST);
  }
  let burstParts = null;
  let cleanScore = null;
  if (reel.burst && reel.blast) {
    // One blast: the kill shot rides its round in and draws back on the dead.
    const shot = await shootKill(page, { ...reel.blast, killer: reel.player, killerVehicle: null, victimVehicle: null }, write, {
      top: OVERLAY_TOP, name: reel.playerName ?? null, label: null, fadeIn: DIP.in,
      streak: { before: 0, after: reel.total }, word: 'KILLS',
    });
    if (shot.ok && shot.audio) audio.push(shot.audio);
    if (!shot.ok) return shot;
  } else if (reel.burst) {
    // One take behind him, unless he is in a hull or the take did not see
    // his kills: then kill by kill as the bullet chase (CLEAN).
    const take = reel.inHull ? null : await filmBurst(page, reel);
    if (take && take.seen >= CLEAN.share) {
      for (const url of take.frames) write(url);
      if (take.audio) audio.push(take.audio);
    } else {
      log(`    burst ${reel.inHull ? 'from a hull' : `take saw ${Math.round((take?.seen ?? 0) * 100)}% of its kills`}: filmed kill by kill`);
      burstParts = reel.shots ?? [];
      if (burstParts.length < 3) return { ok: false, why: 'its kills cannot be filmed one by one' };
    }
    cleanScore = take?.seen ?? null;
  }
  if (reel.asmr) {
    for (const part of reel.parts) {
      const got = await filmTake(page, part, write);
      if (got.audio) audio.push(got.audio);
    }
  }
  // A streak's last part is the kill that ended it, when it can be filmed.
  const parts = reel.burst ? burstParts ?? [] : reel.asmr ? []
    : reel.streak && reel.ending ? [...reel.parts, { ...reel.ending, ending: true }]
      : reel.parts;
  // Each part's frames and its hit, for the cold open.
  const marks = [];
  for (const [i, part] of parts.entries()) {
    // A long way between two of one player's kills: the map card, the route
    // he took and how long (EDITS.md, the context bridge).
    if (i > 0 && (reel.player !== undefined || reel.streak) && part.t - parts[i - 1].t >= MAP_CARD.gap) {
      const card = await mapCard(page, reel, parts[i - 1], part);
      if (card?.length) {
        for (const url of card) write(url);
        audio.push([-100, -100 + card.length / FPS]);
      }
    }
    // A vehicle kill in a compilation is the bullet chase: one round, the
    // shot and the death one clip (the owner, 2026-11-03: the volley "cuts
    // off the shot and the death of the victim feels like a completely
    // unrelated clip"). Air kills stay the volley.
    if (part.mode === 'shot') {
      const held = [];
      const shot = await shootKill(page, part, url => held.push(url), {
        top: OVERLAY_TOP,
        streak: reel.streak || reel.burst ? streakCounts(part, reel) : null, word: reel.burst ? 'KILLS' : undefined,
        name: reel.playerName ?? null, label: reel.streak ? streakLabel(part, reel) : reel.burst ? null : partLabel(i, reel.parts.length, part, reel), fadeIn: DIP.in,
      });
      // Out through the dip: the last frames quicken, then go to black.
      const out = await dipOut(page, held);
      const start = n;
      for (const url of out.frames) write(url);
      if (shot.audio) shot.audio = [shot.audio[0], shot.audio[1] - out.dropped / FPS];
      if (shot.ok && shot.audio && Number.isInteger(shot.hitFrame)) {
        marks.push({ start, end: n, hit: start + shot.hitFrame, audioFrom: shot.audio[0], score: part.score ?? 0, ending: Boolean(part.ending) });
      }
      if (shot.ok && shot.audio) audio.push(shot.audio);
      if (!shot.ok) log(`    part ${i + 1} left out: ${shot.why}`);
      continue;
    }
    const holdFrames = Math.round((part.mode === 'volley' ? REEL_BEAT.volleyHold : reel.player !== undefined ? REEL_BEAT.playerHold : REEL_BEAT.hold) * FPS);
    const spawn = part.kind === 'spawn-death' ? part.spawned : null;
    // A volley (air to air): the killer followed, the victim's fall shown.
    const volley = part.mode === 'volley';
    await page.evaluate(({ from, victim }) => {
      const r = window.replay;
      r.creator.toggle(false);
      r.seek(Math.max(0, from));
      r.speed = 1;
      // The camera settles on him with the clock stopped.
      r.playing = false;
      if (r.ui?.follow) r.ui.follow(victim);
      else r.follow(victim);
      if (r.ui?.setMode) r.ui.setMode('chase');
      else r.camera.setMode('chase');
    }, { from: spawn !== null ? spawn + 0.05 : part.t - (reel.player !== undefined ? REEL_BEAT.playerLead : volley ? REEL_BEAT.volleyLead : REEL_BEAT.lead), victim: volley ? part.killer : part.victim });
    if (volley) {
      await page.evaluate(async ({ t, killer, victim, beat, FPS }) => {
        const r = window.replay;
        const B = (window.__rb ??= await import(new URL('replay-battles.js', location.href).href));
        const cam = r.ctx.camera;
        const st = { lift: 0, latched: false, base: cam.fov };
        window.__volleyFov = cam.fov;
        const V = cam.position.clone();
        const K = cam.position.clone();
        const at = (pid, time) => B.whereIs(r.rec, pid, time, r.kills ?? r.rec.kills)?.pos ?? null;
        const toCam = (out, cm) => out.applyMatrix4(cm.matrixWorldInverse);
        const ease = k => 1 - Math.exp(-1 / (k * FPS));
        r.camera.setLensHook(c => {
          const now = r.time;
          let want = st.base;
          const vp = now > t - 2.5 ? (at(victim, Math.min(now, t + 3)) ?? at(victim, t - 0.1)) : null;
          const kp = vp ? at(killer, now) : null;
          c.updateMatrixWorld();
          c.matrixWorldInverse.copy(c.matrixWorld).invert();
          if (vp && kp && !st.latched && now < t + 0.5) {
            const v = toCam(V.set(vp[0], vp[1], vp[2]), c);
            const k = toCam(K.set(kp[0], kp[1], kp[2]), c);
            if (v.z < -1 && k.z < -1 && -v.z > -k.z) {
              const ax = Math.abs(Math.atan2(v.x, -v.z) - Math.atan2(k.x, -k.z));
              const ay = Math.abs(Math.atan2(v.y, -v.z) - Math.atan2(k.y, -k.z));
              if (ax < Math.atan(7 / -k.z) && ay < Math.atan(2.5 / -k.z)) st.latched = true;
            }
          }
          st.lift += ((st.latched ? beat.volleyLift : 0) - st.lift) * ease(beat.volleyLiftTime);
          if (st.lift > 0.01) {
            c.position.y += st.lift;
            c.updateMatrixWorld();
            c.matrixWorldInverse.copy(c.matrixWorld).invert();
          }
          if (vp) {
            const v = toCam(V.set(vp[0], vp[1], vp[2]), c);
            if (v.z < -1) {
              const half = Math.max(Math.atan(Math.abs(v.y) / -v.z), Math.atan(Math.abs(v.x) / (-v.z * c.aspect)));
              want = Math.min(beat.volleyFov, Math.max(st.base, (2 * Math.atan(Math.tan(half) / beat.volleyFit) * 180) / Math.PI));
            }
          }
          const next = c.fov + (want - c.fov) * ease(0.35);
          if (Math.abs(next - c.fov) > 0.01) {
            c.fov = next;
            c.updateProjectionMatrix();
          }
          window.__volleyState = st;
        });
      }, { t: part.t, killer: part.killer, victim: part.victim, beat: REEL_BEAT, FPS });
    }
    await page.waitForTimeout(1200);
    for (let k = 0; k < 20; k++) {
      await page.evaluate(async ({ W, H, FPS }) => {
        window.__clock.step(1000 / FPS);
        window.__renderOnce(W, H, 1 / FPS);
        await window.__audioStep?.(1 / FPS);
      }, { W, H, FPS });
    }
    await page.evaluate(() => { window.replay.playing = true; });
    const stand = volley ? REEL_BEAT.hull : part.kind === 'spawn-death' ? null : part.cause === 'crash' ? REEL_BEAT.hull : REEL_BEAT.man;
    let post = -1;
    let from = null;
    let partStart = null;
    let partHit = null;
    for (let k = 0; k < MAX_FRAMES && post < holdFrames; k++) {
      const res = await page.evaluate(async ({ W, H, FPS, t, spawn, killer, victim, volley, post, beat, stand, name, label, holdFrames, streak }) => {
        const r = window.replay;
        const at = window.__audioT?.() ?? null;
        let p = post;
        if (volley) {
          // Behind the killer the whole time; the clock eases into slow motion
          // before the kill. The lens hook (installed for the part) lifts the
          // eye when his own plane hides the victim and opens the lens if the
          // victim would leave the frame.
          const u = Math.max(0, Math.min(1, (r.time - (t - beat.volleyEase)) / beat.volleyEase));
          const e = u * u * (3 - 2 * u);
          r.speed = 1 + (beat.volleySlow - 1) * e;
          if (p < 0 && r.time >= t) p = 0;
        } else if (p < 0 && r.time >= t) {
          let body = r.camera.targetAt?.(r.time)?.point?.clone?.() ?? null;
          let was = r.ctx.camera.position.clone();
          if (volley && body) {
            // The camera stands on the killer's side of his victim, looking at
            // the victim: the plane he shot coming apart.
            const B = await import(new URL('replay-battles.js', location.href).href);
            const w = B.whereIs(r.rec, victim, t - 0.1, r.kills ?? r.rec.kills);
            if (w?.pos) {
              was = body.clone();
              body = body.clone().set(w.pos[0], w.pos[1], w.pos[2]);
            }
          }
          if (r.ui?.setMode) r.ui.setMode('free');
          else r.camera.setMode('free');
          if (body) {
            let pos;
            let look;
            if (stand) {
              // An own goal: back from where he died and up, looking down at it.
              const away = was.clone().sub(body);
              away.y = 0;
              if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
              away.normalize();
              pos = body.clone().addScaledVector(away, stand[0]);
              pos.y = body.y + stand[1];
              look = body.clone();
            } else {
              // A spawn death: behind his body, looking toward his killer.
              const B = await import(new URL('replay-battles.js', location.href).href);
              const w = B.whereIs(r.rec, killer, r.time, r.kills ?? r.rec.kills);
              const kp = w?.pos ? body.clone().set(w.pos[0], w.pos[1] + 1.2, w.pos[2]) : null;
              const toward = kp ? kp.clone().sub(body) : body.clone().sub(was);
              toward.y = 0;
              if (toward.lengthSq() < 1e-4) toward.set(0, 0, -1);
              const dist = toward.length();
              toward.normalize();
              pos = body.clone().addScaledVector(toward, -beat.behind);
              pos.y = body.y + beat.up;
              look = body.clone().addScaledVector(toward, Math.min(dist, 25));
              look.y = kp ? Math.max(body.y, Math.min(kp.y, body.y + 6)) : body.y;
            }
            const floor = r.ctx.groundHeight?.(pos.x, pos.z);
            if (Number.isFinite(floor) && pos.y < floor + 2) pos.y = floor + 2;
            const d = look.sub(pos);
            const free = r.camera.free;
            free.pos.copy(pos);
            free.yaw = Math.atan2(-d.x, -d.z);
            free.pitch = Math.asin(Math.max(-1, Math.min(1, d.y / d.length())));
          }
          r.speed = beat.slow;
          p = 0;
        }
        window.__clock.step(1000 / FPS);
        window.__renderOnce(W, H, 1 / FPS);
        await window.__audioStep?.(1 / FPS);
        const cv = (window.__reelCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
        const g = cv.getContext('2d');
        const grey = p < 0 || volley ? 0 : Math.min(1, p / (beat.grey * FPS));
        g.filter = grey > 0 ? `grayscale(${grey}) contrast(${1 + 0.2 * grey}) brightness(${1 - 0.2 * grey})` : 'none';
        g.drawImage(window.__renderer.domElement, 0, 0, W, H);
        g.filter = 'none';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if (spawn !== null) {
          const lived = Math.max(0, Math.min(r.time, t) - spawn);
          const text = `${lived.toFixed(1)} s`;
          g.font = '800 92px system-ui, "Segoe UI", sans-serif';
          const w = g.measureText(text).width + 70;
          g.fillStyle = p < 0 ? 'rgba(12,12,10,0.6)' : 'rgba(150,24,20,0.8)';
          g.beginPath();
          g.roundRect(W / 2 - w / 2, 150 + beat.top, w, 120, 60);
          g.fill();
          g.fillStyle = '#f6f1e2';
          g.fillText(text, W / 2, 212 + beat.top);
        }
        if (label) {
          g.font = '700 40px system-ui, "Segoe UI", sans-serif';
          g.fillStyle = 'rgba(246,241,226,0.85)';
          g.fillText(label, W / 2, 110 + beat.top);
        }
        if (streak) window.__streakBadge(g, W, 310 + beat.top, streak.before, streak.after, p, streak.word);
        if (name) {
          // Whose this part is: the man followed, his name as the site shows it.
          const V = (window.__vp ??= await import(new URL('vehicle-players.js', location.href).href));
          const shown = V.decodePlayerName ? V.decodePlayerName(name) : name;
          const y = (spawn !== null ? 330 : 200) + beat.top;
          g.font = '800 64px system-ui, "Segoe UI", sans-serif';
          const w = g.measureText(shown).width + 64;
          g.fillStyle = 'rgba(12,12,10,0.62)';
          g.beginPath();
          g.roundRect(W / 2 - w / 2, y - 48, w, 96, 48);
          g.fill();
          g.fillStyle = '#f6f1e2';
          g.fillText(shown, W / 2, y + 2);
        }
        // Fade to black at the end of the beat, into the next.
        const fadeFrom = holdFrames - beat.fade * FPS;
        if (p >= fadeFrom) {
          g.fillStyle = `rgba(0,0,0,${Math.min(1, (p - fadeFrom + 1) / (beat.fade * FPS))})`;
          g.fillRect(0, 0, W, H);
        }
        return { at, post: p, url: cv.toDataURL('image/jpeg', 0.92) };
      }, { W, H, FPS, t: part.t, spawn, killer: part.killer, victim: part.victim, volley, post, beat: REEL_BEAT, stand,
        name: reel.player !== undefined ? reel.playerName : reel.parts.length > 1 ? part.victimName : null,
        label: reel.streak ? streakLabel(part, reel) : reel.burst ? null : reel.parts.length > 1 ? partLabel(i, reel.parts.length, part, reel) : null, holdFrames,
        streak: reel.streak || reel.burst ? { ...streakCounts(part, reel), word: reel.burst ? 'KILLS' : undefined } : null });
      if (from === null) {
        from = res.at;
        partStart = n;
      }
      if (res.post === 0) partHit = n;
      write(res.url);
      post = res.post < 0 ? -1 : res.post + 1;
    }
    const to = await page.evaluate(() => {
      // The lens a volley widened goes back for the next part.
      const cam = window.replay.ctx.camera;
      if (window.__volleyFov !== undefined) {
        window.replay.camera.setLensHook(null);
        cam.fov = window.__volleyFov;
        cam.updateProjectionMatrix();
        delete window.__volleyFov;
      }
      window.replay.speed = 1;
      return window.__audioT?.() ?? null;
    });
    if (from !== null && to !== null) {
      audio.push([from, to]);
      if (partHit !== null) marks.push({ start: partStart, end: n, hit: partHit, audioFrom: from, score: part.score ?? 0, ending: Boolean(part.ending) });
    }
  }
  // A streak ends on how it ended: its count, and who stopped it.
  if ((reel.streak || reel.burst) && n >= FPS) {
    const card = await page.evaluate(({ W, H, total, name, by, endedAt, burst }) => {
      const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const g = cv.getContext('2d');
      const shot = alpha => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, W, H);
        g.globalAlpha = alpha;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#e8c35a';
        g.font = '800 64px system-ui, "Segoe UI", sans-serif';
        g.fillText(name, W / 2, H / 2 - 190);
        g.fillStyle = '#f6f1e2';
        g.font = '900 220px system-ui, "Segoe UI", sans-serif';
        g.fillText(String(total), W / 2, H / 2 - 10);
        g.font = '800 58px system-ui, "Segoe UI", sans-serif';
        g.fillText(burst ? `kills in ${burst} seconds` : 'kills in one life', W / 2, H / 2 + 150);
        if (!burst) {
          g.fillStyle = 'rgba(246,241,226,0.75)';
          g.font = '700 46px system-ui, "Segoe UI", sans-serif';
          g.fillText(by ? `Ended by ${by}` : endedAt === null ? 'Still going at the end of the round' : 'Ended by his own hand', W / 2, H / 2 + 250);
        }
        g.globalAlpha = 1;
        return cv.toDataURL('image/jpeg', 0.92);
      };
      return [shot(0.25), shot(0.5), shot(0.75), shot(1)];
    }, { W, H, total: reel.total, name: reel.playerShown ?? reel.playerName ?? '', by: reel.endedByShown ?? reel.endedByName ?? null,
      endedAt: reel.endedAt ?? null, burst: reel.burst ? Math.max(1, Math.round(reel.span)) : null });
    const fadeIn = [0, 0, 1, 1, 2, 2, 3];
    for (const k of fadeIn) write(card[k]);
    for (let k = 0; k < Math.round(STREAK_CARD * FPS); k++) write(card[3]);
  }
  if (n < FPS) return { ok: false, why: `only ${n} frames` };
  // A compilation opens on its best hit (EDITS.md, the cold open), and each
  // part's sound comes in just before its picture (the J-cut).
  if ((reel.player !== undefined || reel.streak) && !reel.burst && marks.length >= 3) {
    // A streak's opens on a hit from its later half: a look ahead at where
    // the count is going (from its kill 3, it read as the count going back
    // to 2 in the first part).
    const pool = reel.streak ? marks.filter((m, i, all) => !m.ending && i >= Math.floor(all.filter(x => !x.ending).length / 2)) : marks;
    n = await coldOpen(page, frames, n, pool.length ? pool : marks, audio);
  }
  jCut(audio);
  const mp4 = path.join(dir, 'short.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.jpg'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-maxrate', '12M', '-bufsize', '24M',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  // The poster: the first death's hold, before its fade.
  const p0 = reel.parts[0];
  const lead = reel.burst || reel.asmr ? 1 : p0.kind === 'spawn-death' ? p0.lived : reel.player !== undefined ? REEL_BEAT.playerLead : p0.mode === 'volley' ? REEL_BEAT.volleyLead : REEL_BEAT.lead;
  const at = Math.min(n - 1, Math.round((lead + 0.5) * FPS + 10));
  const poster = path.join(dir, 'poster.jpg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(frames, `f${String(at).padStart(4, '0')}.jpg`),
    '-vf', 'scale=540:960', '-q:v', '4', poster]);
  fs.rmSync(frames, { recursive: true, force: true });
  const names = await page.evaluate(({ kv, vv, weapon }) => {
    const c = window.replay.creator;
    const d = s => (s ? c.display(s) || s : null);
    return { killerVehicle: d(kv), victimVehicle: d(vv), weapon: d(weapon) };
  }, { kv: reel.parts[0].killerVehicle ?? null, vv: reel.parts[0].victimVehicle ?? null, weapon: reel.parts[0].weapon ?? null });
  return { ok: true, mp4, poster, audio: audio.length ? audio : null, frames: n, edited: n,
    lengthSeconds: Math.round((n / FPS) * 10) / 10, names };
}

/** One Short filmed into `dir`: frames, then the MP4 and its poster. */
async function film(page, cand, dir, view = null) {
  // Own goals and spawn deaths are reels; one of them alone is a reel of one.
  if (cand.reel) return filmReel(page, cand, dir);
  // Air to air is the volley, not one round (the owner, 2026-11-03: "it's not
  // one bullet that kills them it's the volley"): the chase camera behind the
  // attacker at 1x, slowed at the kill, the victim's fall held.
  if (cand.kind === 'air-to-air') return filmReel(page, { parts: [{ ...cand, mode: 'volley' }] }, dir);
  if (cand.kind === 'own-goal' || cand.kind === 'spawn-death') return filmReel(page, { parts: [cand] }, dir);
  const frames = path.join(dir, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  let n = 0;
  const shot = await shootKill(page, cand, url => {
    fs.writeFileSync(path.join(frames, `f${String(n++).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  });
  if (!shot.ok) return shot;
  const { hitFrame, names } = shot;
  const setup = { kill: shot.kill, names };
  const edited = n;
  const audio = shot.audio ? [shot.audio] : null;
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

/**
 * The creator's one-click kill shot of `cand` (the bullet chase, the Shorts
 * look), each recorded frame handed to `write` as a data URL. `overlay`
 * (`{ name, label, fadeIn }`) draws a compilation's player name and count over
 * it and fades its first frames in from black. `{ ok, frames, hitFrame,
 * audio: [from, to], kill, names }`.
 */
async function shootKill(page, cand, write, overlay = null) {
  await armCreator(page, { lower: !overlay });
  await page.evaluate(() => { delete window.__streakHitAt; });
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
    const res = await page.evaluate(async ({ W, H, FPS, overlay, n, trace }) => {
      const at = window.__audioT?.() ?? null;
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
      const c = window.replay.creator;
      const rec = c.recorder;
      const out = { rec: Boolean(rec), state: c.rounds?.state ?? null, at };
      if (trace) {
        // --trace: the round against its victim, each frame.
        const r = window.replay;
        const B = (window.__rb ??= await import(new URL('replay-battles.js', location.href).href));
        const RC = (window.__rcm ??= await import(new URL('replay-roundcam.js', location.href).href));
        const rc = c.rounds;
        const kill = rc.target?.kill;
        const w = kill ? B.whereIs(r.rec, kill.victim, r.time, r.kills ?? r.rec.kills) : null;
        const hl = kill ? RC.victimHullLife(r.rec, kill) : null;
        const hull = hl ? [...r.hulls.values()].find(h => h.life === hl) : null;
        out.trace = { t: +r.time.toFixed(3), speed: +r.speed.toFixed(3), state: rc.state, kill: kill?.t,
          fireAt: rc.target?.fireAt, landAt: rc.target?.landAt, held: rc.target?.fired,
          round: rc.state === 'flying' || rc.state === 'impact' ? rc.pos.toArray().map(x => +x.toFixed(1)) : null,
          victim: w?.pos ? [w.pos[0], w.pos[1], w.pos[2]].map(x => +x.toFixed(1)) : null, vstate: w?.state,
          hullHp: hull?.lastHp ?? null, diesAt: hull?.diesAt?.at ?? null,
          ground: rc.state === 'flying' || rc.state === 'impact' ? +(r.ctx.groundHeight?.(rc.pos.x, rc.pos.z) ?? NaN).toFixed(1) : null,
          hit: r.ctx.guns?.hits?.[0]?.point?.map(x => +x.toFixed(1)) ?? null };
      }
      if (rec?.started) {
        const src = rec.source ?? window.__renderer.domElement;
        if (!overlay) out.url = src.toDataURL('image/jpeg', 0.92);
        else {
          const cv = (window.__shotCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
          const g = cv.getContext('2d');
          g.drawImage(src, 0, 0, W, H);
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          if (overlay.label) {
            g.font = '700 40px system-ui, "Segoe UI", sans-serif';
            g.fillStyle = 'rgba(246,241,226,0.85)';
            g.fillText(overlay.label, W / 2, 110 + overlay.top);
          }
          if (overlay.streak) {
            if (out.state === 'impact' && window.__streakHitAt === undefined) window.__streakHitAt = n;
            const since = window.__streakHitAt === undefined ? -1 : n - window.__streakHitAt;
            window.__streakBadge(g, W, 310 + overlay.top, overlay.streak.before, overlay.streak.after, since, overlay.word);
          }
          if (overlay.name) {
            const V = (window.__vp ??= await import(new URL('vehicle-players.js', location.href).href));
            const shown = V.decodePlayerName ? V.decodePlayerName(overlay.name) : overlay.name;
            g.font = '800 64px system-ui, "Segoe UI", sans-serif';
            const w = g.measureText(shown).width + 64;
            g.fillStyle = 'rgba(12,12,10,0.62)';
            g.beginPath();
            g.roundRect(W / 2 - w / 2, 152 + overlay.top, w, 96, 48);
            g.fill();
            g.fillStyle = '#f6f1e2';
            g.fillText(shown, W / 2, 202 + overlay.top);
          }
          // In from black, so each kill reads as its own.
          if (n < overlay.fadeIn) {
            g.fillStyle = `rgba(0,0,0,${1 - n / overlay.fadeIn})`;
            g.fillRect(0, 0, W, H);
          }
          out.url = cv.toDataURL('image/jpeg', 0.92);
        }
      }
      return out;
    }, { W, H, FPS, overlay, n, trace: TRACE });
    if (res.trace) traceLog.push(res.trace);
    if (res.url) {
      if (n === 0) audioFrom = res.at;
      write(res.url);
      if (hitFrame === null && res.state === 'impact') hitFrame = n;
      n++;
      framesWritten++;
    }
    if (!res.rec && n > 0) break;
  }
  if (TRACE) fs.writeFileSync(path.join(OUT, `trace-${cand.t.toFixed(2)}-${cand.victim}.json`), JSON.stringify(traceLog.splice(0)));
  if (n < FPS) return { ok: false, why: `only ${n} frames` };
  const to = await page.evaluate(() => window.__audioT?.() ?? null);
  return { ok: true, frames: n, hitFrame, audio: audioFrom === null || to === null ? null : [audioFrom, audioFrom + n / FPS],
    kill: setup.kill, names: setup.names };
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
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-af', 'apad', '-shortest', '-movflags', '+faststart', made.mp4]);
    fs.rmSync(silent);
    log(`  sound added to ${path.basename(dir)}`);
  });
}

async function remove(slug) {
  const res = await fetchRetry(`${TO}/stats/shorts/${slug}`, { method: 'DELETE', headers: { 'X-Shorts-Key': KEY } });
  if (!res.ok && res.status !== 404) throw new Error(`delete ${slug}: ${res.status}`);
  log(`  replaced ${slug}`);
}

/** The API takes a video of 90 MiB at most, just under the 100 MB the edge
 *  passes in one request: one over FIT_BYTES is encoded again at the bitrate
 *  that fits. Under the old 40 MiB every long compilation was, at about seven
 *  minutes each (2026-11-04); now none is expected to be. */
const FIT_BYTES = 90 * 1000 * 1000;
function fitSize(mp4) {
  if (fs.statSync(mp4).size <= FIT_BYTES) return;
  const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }));
  const kbps = Math.floor(((FIT_BYTES * 8) / Math.max(1, secs)) * 0.9 / 1000) - 160;
  const big = `${mp4}.big.mp4`;
  fs.renameSync(mp4, big);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', big, '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${kbps}k`,
    '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-c:a', 'copy', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  fs.rmSync(big);
  log(`  re-encoded ${path.basename(path.dirname(mp4))} to ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);
}

async function upload(meta, made) {
  fitSize(made.mp4);
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
const launch = () => chromium.launch({
  args: args.includes('--swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : args.includes('--gpu') ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] : [],
});
let browser = await launch();
const pidFile = path.join(OUT, 'runner.pid');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(pidFile, String(process.pid));
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
      const kindsWanted = many('kinds').flatMap(k => k.split(','));
      const only = LIVE
        ? LIVE.get(r.slug).filter(s => !kindsWanted.length || kindsWanted.includes(s.kind)).map(s => [s.killTime, s.victimPid])
        : many('kill').map(k => k.split(':').map(Number));
      // --kinds=own-goal,... films only those kinds (adding one kind to
      // recordings already clipped).
      const kinds = many('kinds').flatMap(k => k.split(','));
      const pool = kinds.length ? cands.filter(c => kinds.includes(c.kind)) : cands;
      const picks = LIVE || only.length
        ? cands.filter(c => only.some(([t, v]) => Math.abs(c.t - t) < 0.05 && c.victim === v))
        : P.pickShorts(pool, { max: MAX, taken: keys });
      // A round's spawn deaths are one reel, never a Short each (--kinds filters).
      // A round's crashes are a reel, each pilot named (the owner, 2026-11-03:
      // "the crashes are nice though, they're interesting"). Spawn deaths,
      // falls and own charges were "really hard to follow" as Shorts: only
      // with --reels.
      const reels = [['own-goal', args.includes('--reels') ? null : ['crash']], ...(args.includes('--reels') ? [['spawn-death', null]] : [])];
      for (const [kind, causes] of reels) {
        const reel = P.reelOf(cands, kind, { slug: r.slug, level: rec.level, causes });
        if (reel && !LIVE && !only.length && !keys.has(reel.key) && (!kinds.length || kinds.includes(kind))) picks.push(reel);
      }
      // Each player's compilation of his air kills, and of his other vehicle
      // kills, when he has five or more (the owner, 2026-11-03); --kinds=player
      // films only these.
      // --kinds=player-air or player-vehicle films only that half.
      const wantsReel = reel => !kinds.length || kinds.includes('player') || kinds.includes(reel.air ? 'player-air' : 'player-vehicle');
      if (!LIVE && !only.length) {
        for (const reel of P.playerReelsOf(P.vehicleKillsOf(rec, { models }), { slug: r.slug, level: rec.level })) {
          if (!wantsReel(reel) || keys.has(reel.key)) continue;
          reel.playerShown = VP.decodePlayerName(reel.playerName);
          picks.push(reel);
        }
        // The round's Battlefield ASMR; --kinds=asmr films only it.
        if (!kinds.length || kinds.includes('asmr')) {
          const ejects = new Set(ejectsOf(r.mod));
          const asmr = P.asmrReelOf(rec, { slug: r.slug, ejects });
          if (asmr && !keys.has(asmr.key)) picks.push(asmr);
        }
        // A player's kill streak in one life, and the round's kill bursts (no
        // player twice); --kinds=streak films only these.
        if (!kinds.length || kinds.includes('streak')) {
          const streaks = P.streakReelsOf(rec, { models, slug: r.slug });
          const bursts = P.burstReelsOf(rec, { slug: r.slug, models, skip: new Set(streaks.map(s => s.player)) });
          for (const reel of [...streaks, ...bursts]) {
            if (keys.has(reel.key)) continue;
            reel.playerShown = VP.decodePlayerName(reel.playerName);
            reel.endedByShown = reel.endedByName ? VP.decodePlayerName(reel.endedByName) : null;
            picks.push(reel);
          }
        }
      }
      // The recording's own player always has a Short when he made a kill
      // the recording holds: his best, else his longest shot (the owner,
      // 2026-11-04: "always prioritise the uploader").
      const star = r.recordedBy || r.uploaderPlayer || null;
      if (!LIVE && !only.length && star && !picks.some(p => p.killerName === star || p.playerName === star)) {
        const own = P.featuredOf(rec, { name: star, cands, models, slug: r.slug });
        if (own && !keys.has(own.key) && !picks.some(p => p.key === own.key)) {
          picks.push(own);
          log(`  featuring ${star}, who recorded it: ${own.kind} at ${own.t.toFixed(1)}`);
        }
      }
      log(`${r.slug} ${r.level} (${r.mod}): ${cands.length} candidates, ${picks.length} to film`);
      // Re-filming: a live Short whose kill the picker no longer passes (out of
      // the recorder's range, a hop) comes down.
      if (LIVE && UPLOAD && cands.length) {
        for (const old of LIVE.get(r.slug).filter(s => !kindsWanted.length || kindsWanted.includes(s.kind))) {
          if (!picks.some(c => P.shortKey(r.slug, c.t, c.victim) === old.key)) {
            await remove(old.slug);
            log(`  took down "${old.title}": the picker no longer passes it`);
          }
        }
      }
      if (!picks.length) continue;
      phase = `loading ${r.slug} ${r.level}`;
      const done = [];
      let page = null;
      // The whole recording, load to sound, within RECORDING_BUDGET; a
      // stalled one is abandoned and the browser started afresh.
      const filmAll = async () => {
        page = await openPage(browser, playUrl(r));
        for (const c of picks) {
          const dir = path.join(OUT, r.slug, `${c.t.toFixed(2)}-${c.victim}`);
          fs.mkdirSync(dir, { recursive: true });
          const t0 = Date.now();
          phase = `filming ${c.kind} at ${c.t.toFixed(1)} on ${r.slug}`;
          const made = await film(page, c, dir, REAL_TIME ? (opt('real-view', null) ?? realView(c)) : null);
          if (!made.ok) {
            log(`  skip ${c.kind} at ${c.t.toFixed(1)}: ${made.why}`);
            continue;
          }
          const display = s => (s === c.killerVehicle ? made.names.killerVehicle : s === c.victimVehicle ? made.names.victimVehicle : s === c.weapon ? made.names.weapon : s) ?? s;
          const meta = {
            recordingSlug: r.slug, killTime: Number(c.t.toFixed(2)), victimPid: c.victim, kind: c.kind,
            title: P.titleOf(c, display), killer: c.killerName ?? '', victim: c.victimName ?? '', weapon: display(c.weapon) ?? '',
            killerVehicle: c.killerVehicle ? display(c.killerVehicle) : null, victimVehicle: c.victimVehicle ? display(c.victimVehicle) : null,
            distance: c.distance, lengthSeconds: made.lengthSeconds, level: r.level, mod: r.mod,
            // Everyone killed in it, for the strip's player filter: a compilation's
            // victims (both men a shell killed), a crash reel's pilots.
            victims: c.reel ? [...new Set(c.parts.flatMap(p => p.victimNames ?? [p.victimName]).filter(Boolean))] : [],
          };
          fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
          log(`  filmed "${meta.title}" ${made.frames} frames in ${Math.round((Date.now() - t0) / 1000)} s, ${(fs.statSync(made.mp4).size / 1e6).toFixed(1)} MB`);
          done.push({ c, meta, made, dir });
        }
        if (SOUND && done.some(d => d.made.audio)) {
          phase = `adding sound on ${r.slug}`;
          await addSound(page, done);
        }
      };
      try {
        await withTimeout(filmAll(), RECORDING_BUDGET, `recording ${r.slug}`);
      } catch (e) {
        log(`  abandoned ${r.slug}: ${e.message}; the browser starts afresh`);
        killBrowser();
        browser = await launch();
        page = null;
        continue;
      } finally {
        if (page) await withTimeout(page.close(), 15000, 'closing the page').catch(() => {});
      }
      phase = `uploading ${r.slug}`;
      for (const { c, meta, made, dir } of done) {
        let slug = null;
        if (UPLOAD) {
          // One Short refused never costs the rest of the recording's.
          try {
            const old = LIVE?.get(r.slug)?.find(s => s.key === P.shortKey(r.slug, meta.killTime, meta.victimPid));
            if (old) await remove(old.slug);
            const short = await upload(meta, made);
            slug = short.slug;
            log(`  uploaded ${slug} "${meta.title}"`);
          } catch (e) {
            log(`  upload failed for "${meta.title}": ${e.message}`);
          }
        }
        summary.push({ recording: r.slug, title: meta.title, kind: c.kind, dir, slug });
      }
    } catch (e) {
      log(`${r.slug}: ${e.message}`);
    }
  }
} finally {
  await withTimeout(browser.close(), 15000, 'closing the browser').catch(() => killBrowser());
  fs.rmSync(pidFile, { force: true });
  clearInterval(heartbeat);
}
console.log(JSON.stringify(summary, null, 2));
