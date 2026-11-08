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
const { rangeRecording } = await import(pathToFileURL(path.join(REPO, 'scripts/shorts-range.mjs')).href);
/** Range recordings served in place of a recording (the arsenal), by path. */
const RANGES = new Map();
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
/** Seconds of audio one page load can render, every Short of it together:
 *  about 0.3 MB a second in the page. 300 s overflowed on a re-record of
 *  Kharkov (eleven Shorts, 358 s, 2026-11-04: "Offset is outside the bounds
 *  of the DataView" as the sound was cut out). */
const AUDIO_SPAN = 1200;
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
/** The sound step's bound: the page renders the rest of AUDIO_SPAN first,
 *  and 1200 s of it outran STEP_TIMEOUT (Kharkov's re-record, 2026-11-04). */
const SOUND_TIMEOUT = 5 * 60 * 1000;
/** One recording, load to sound, may take this long in all; --budget=<min>
 *  for a re-record of a busy round (El Alamein's twelve Shorts outran 25). */
const RECORDING_BUDGET = Number(opt('budget', 25)) * 60 * 1000;
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
    fs.rmSync(path.join(OUT, 'runner.pid'), { force: true });
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

/** One round, several recordings: what makes two Shorts the same moment.
 *  A compilation's kind is its victim code's thousands (1 air, 2 vehicle,
 *  3 streak, 4 burst; the code also holds a player id, which is the
 *  recording's own) and its player; a single kill is killer, victim and the
 *  time in the round. */
function momentOf(c, offset) {
  // A pick (c.t, c.victim the id) or a live Short (killTime, victimPid; its
  // victim is the name).
  const live = c.killTime !== undefined;
  const code = live ? c.victimPid : c.victim;
  return {
    reel: code < 0 ? Math.floor(-code / 1000) || -code : 0,
    killer: (live ? c.killer : c.killerName ?? c.playerName) ?? '',
    victim: (live ? c.victim : c.victimName) ?? '',
    t: (live ? c.killTime : c.t) + offset,
  };
}
const sameMoment = (a, b) => a.reel === b.reel && a.killer === b.killer
  && (a.reel !== 0 || (a.victim === b.victim && Math.abs(a.t - b.t) < 1.5));
/** Shorts filmed in this run, as moments of their round. */
const filmedMoments = [];
let allLive = null;
/** The moments other recordings of `r`'s round already have as Shorts. */
async function roundTwinMoments(r) {
  const twins = (r.round ?? []).filter(x => x.slug !== r.slug);
  if (!twins.length) return [];
  if (!allLive) {
    allLive = [];
    for (let page = 1; ; page++) {
      const res = await json(`${TO}/stats/shorts?days=60&pageSize=48&page=${page}`).catch(() => null);
      if (!res) break;
      allLive.push(...res.items);
      if (page * res.pageSize >= res.total) break;
    }
  }
  return twins.flatMap(x => [
    ...allLive.filter(s => s.recordingSlug === x.slug && !s.creatorName).map(s => ({ ...momentOf(s, x.roundOffsetSeconds ?? 0), slug: x.slug })),
    ...filmedMoments.filter(m => m.slug === x.slug),
  ]);
}

/** --fresh: film every pick of the recordings, as if none were live. */
const FRESH = args.includes('--fresh');

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

/** The tree's models, `Map<lower name, row>`: the mod's own, else vanilla's.
 *  On a machine without the extracted trees (a Mac), the live site's copy. */
const modelTables = new Map();
async function modelsOf(mod) {
  const rel = `models/mods/${String(mod).toLowerCase()}/models.json`;
  const own = path.join(VIEWER, rel);
  const local = fs.existsSync(own) ? own : path.join(VIEWER, 'models/models.json');
  let rows;
  if (fs.existsSync(local)) rows = JSON.parse(fs.readFileSync(local, 'utf8'));
  else {
    if (!modelTables.has(rel)) {
      const res = await fetchRetry(`${PLAY}/${rel}`);
      modelTables.set(rel, res.ok ? await res.json() : await json(`${PLAY}/models/models.json`));
    }
    rows = modelTables.get(rel);
  }
  return new Map(rows.map(m => [m.name.toLowerCase(), m]));
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
  // The sound renders the whole offline span before it gives anything back:
  // longer than a frame's step (SOUND_TIMEOUT).
  page.evaluateLong = (fn, arg, ms) => withTimeout(evaluate(fn, arg), ms, 'the sound');
  page.on('pageerror', e => log('pageerror', e.message.slice(0, 200)));
  // The arsenal's range recordings: one gun cut out of a round (shorts-range.mjs).
  await page.route(u => RANGES.has(new URL(u).pathname), r => r.fulfill({
    body: RANGES.get(new URL(r.request().url()).pathname), contentType: 'application/x-ndjson',
  }));
  // A page served from elsewhere than the play site (--play=http://localhost:...,
  // a viewer change filmed before it deploys) asks its own origin for the
  // recordings: they are the API's.
  if (new URL(PLAY).origin !== 'https://play.bfstats.io') {
    const origin = new URL(PLAY).origin;
    await page.route(u => { const x = new URL(u); return x.origin === origin && x.pathname.startsWith('/stats/'); },
      async r => { const x = new URL(r.request().url()); r.fulfill({ response: await r.fetch({ url: `${API}${x.pathname}${x.search}` }) }); });
  }
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
    // offline render gives its buffer only at its end. A range with a third
    // entry is slowed like tape: one video frame of `spf` samples per entry,
    // each reading that many seconds of the render (`stretch` below).
    window.__audioWavs = async (shorts, spf) => {
      const a = window.__audio;
      if (!a?.__done) return shorts.map(() => null);
      realResume.call(a);
      const buf = await a.__done;
      const L = buf.getChannelData(0);
      const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
      return shorts.map(ranges => {
        const spans = ranges.map(([t0, t1, adv]) => [Math.round(t0 * rate), Math.round(t1 * rate), adv]);
        const n = spans.reduce((s, [a0, a1, adv]) => s + (adv ? adv.length * spf : a1 - a0), 0);
        const out = new DataView(new ArrayBuffer(44 + n * 4));
        const str = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
        str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt ');
        out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
        out.setUint32(24, rate, true); out.setUint32(28, rate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
        str(36, 'data'); out.setUint32(40, n * 4, true);
        let o = 44;
        const put = (l, r) => {
          out.setInt16(o, Math.max(-1, Math.min(1, l)) * 32767, true);
          out.setInt16(o + 2, Math.max(-1, Math.min(1, r)) * 32767, true);
          o += 4;
        };
        for (const [a0, a1, adv] of spans) {
          if (adv) {
            // Read the render at a rate that follows the picture's speed,
            // eased frame to frame, between samples linearly.
            let x = a0;
            for (let j = 0; j < adv.length; j++) {
              const s0 = adv[j] * rate / spf;
              const s1 = (adv[j + 1] ?? adv[j]) * rate / spf;
              for (let q = 0; q < spf; q++) {
                const i = Math.floor(x);
                const f = x - i;
                put((L[i] ?? 0) * (1 - f) + (L[i + 1] ?? 0) * f, (R[i] ?? 0) * (1 - f) + (R[i + 1] ?? 0) * f);
                x += s0 + (s1 - s0) * (q / spf);
              }
            }
            continue;
          }
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
const CLEAN = Object.freeze({ share: 0.6, margin: 0.9, chest: 1.1, slack: 1.5, skip: 3 });
const CLEAN_TEST = `window.__clean = (pid, t) => {
  const r = window.replay;
  const cam = r.ctx.camera;
  const why = window.__cleanWhy ??= [];
  const w = window.__rbSync?.whereIs(r.rec, pid, t, r.kills ?? r.rec.kills);
  if (!w?.pos) { why.push('no place'); return false; }
  const p = cam.position.clone().set(w.pos[0], w.pos[1] + ${CLEAN.chest}, w.pos[2]);
  const ndc = p.clone().project(cam);
  if (!(ndc.z < 1) || Math.abs(ndc.x) > ${CLEAN.margin} || Math.abs(ndc.y) > ${CLEAN.margin}) {
    why.push('off frame ' + ndc.x.toFixed(2) + ',' + ndc.y.toFixed(2) + ',' + ndc.z.toFixed(2));
    return false;
  }
  // What the picture draws at his chest: nothing nearer than him (a wall,
  // a roof) means he is seen. The collider missed roofs and caught sandbags.
  if (!window.__depth?.take(cam)) return true;
  // Hidden only by something between the man the camera follows and the
  // victim: over the shoulder the victim sits behind the shooter's own back.
  const drawn = r.camera.targetAt?.(r.time)?.point;
  const own = drawn ? drawn.distanceTo(cam.position) + ${CLEAN.slack} : 0;
  const z = window.__depth.at(p, cam);
  const ok = z >= p.distanceTo(cam.position) - ${CLEAN.slack} || z <= own;
  if (!ok) why.push('hidden at ' + z.toFixed(1) + ' of ' + p.distanceTo(cam.position).toFixed(1));
  return ok;
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
 * `slow` was 0.4 until 2026-11-09 ("we're slowing down too much").
 */
const BURST_PACE = Object.freeze({ cap: 30, maxSpeed: 4, slow: 0.75, before: 0.25, after: 0.45, ease: 0.25, fade: 10 });

/**
 * A streak's stretch in one take (the picker's `stretchesOf`;
 * features/replay-shorts/STREAK_REVIEW.md): the clock at a base speed (1x to
 * `maxSpeed`) that gives the round between kills about `perKill` seconds of
 * video a kill (`minRest` at least), easing to `slow` from `before` each kill
 * to `after` it. At his death the clock goes to `endSlow`, the camera stands
 * and draws back over `settle` seconds to show him and the man who killed him,
 * the picture drains to grey over `grey`, and the take holds `hold` seconds.
 * `title` frames of the first take carry the streak's title; a victim's tag
 * shows from `tagBefore` before his death to `tagAfter` after; a kill feed row
 * lasts `feedFrames`; kills not shown between two takes roll by on the count
 * as the next fades in (`rollFrames`); captions sit at `caption` px.
 * Lighter since 2026-11-09 (the owner: "we're slowing down too much in the
 * slow mo"): `slow` 0.45 to 0.75, `endSlow` 0.35 to 0.5, `hold` 2.6 to 2.
 */
const STRETCH_PACE = Object.freeze({
  maxSpeed: 2.5, perKill: 1.0, minRest: 2.5, slow: 0.75, before: 0.15, after: 0.35, ease: 0.2,
  endSlow: 0.5, settle: 1.0, grey: 0.5, hold: 2.0, title: 60, tagBefore: 3.0, tagAfter: 0.8, feedFrames: 75,
  caption: 1420,
});

/**
 * Around each kill of a stretch the camera goes over his shoulder toward the
 * man he is killing (the first take, 2026-11-04: the chase points the way he
 * faces, and three of four kills by a wall were off the picture): from
 * `before` seconds of round ahead of the kill to `after` past it, `back`
 * metres behind him on the line from the victim, `up` over his eye and
 * `side` to one side, eased over `ease` seconds. A pose is tried on either
 * shoulder, then `closer` of the way in, and taken when he is seen and less
 * than `wall` of the picture is within `wallNear` metres; none clear leaves
 * the chase as placed. The ending's two-shot stands `twoShot` metres or more
 * off the line between him and his killer, `twoUp` up.
 */
const AIM = Object.freeze({
  before: 3.0, after: 0.6, back: 2.8, up: 0.5, side: 0.55, ease: 0.3, closer: 0.6, wall: 0.3, wallNear: 1.5, probeEvery: 6,
  twoShot: 5, twoUp: 1.8,
  // In a hull (rafal_pl's Panther bunker): over the hull, `hullBack` behind
  // its centre and `hullUp` up, `hullSide` to either side when straight
  // behind is blocked; he counts as seen when the picture reaches within
  // `hullSlack` metres of the hull's centre (its armour is nearer).
  hullBack: 10, hullUp: 3.5, hullSide: 3, hullSlack: 6,
});

/** The streak take's overlay, drawn in the page over each frame
 *  (`window.__streakDraw`): his name and side, enemy tags over the men he
 *  kills and the man who kills him, a gold marker over him, the kill feed in
 *  side colours, the title and the ending's caption. Gold is always him, red
 *  always the other side. */
const STREAK_DRAW = `window.__streakDraw = (() => {
  const GOLD = '#e8c35a', RED = '#e0584a', INK = '#f6f1e2', BG = 'rgba(12,12,10,0.66)';
  const font = (w, px) => w + ' ' + px + 'px system-ui, "Segoe UI", sans-serif';
  const pill = (g, x, y, w, h, fill) => { g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill(); };
  return {
    GOLD, RED,
    /** His name and side in one pill, centred at y. */
    name(g, W, y, name, side) {
      g.textBaseline = 'middle';
      g.font = font(800, 64);
      const wn = g.measureText(name).width;
      const s = side ? side.toUpperCase() : '';
      g.font = font(800, 30);
      const ws = s ? g.measureText(s).width + 28 : 0;
      const w = wn + ws + 64;
      pill(g, W / 2 - w / 2, y - 48, w, 96, 'rgba(12,12,10,0.62)');
      g.textAlign = 'left';
      g.font = font(800, 64);
      g.fillStyle = INK;
      g.fillText(name, W / 2 - w / 2 + 32, y + 2);
      if (s) {
        g.font = font(800, 30);
        g.fillStyle = GOLD;
        g.fillText(s, W / 2 - w / 2 + 32 + wn + 28, y + 4);
      }
      g.textAlign = 'center';
    },
    /** A tag over a man's head at screen (x, y): a pill with his name and a
     *  pointer, or the pointer alone. */
    tag(g, x, y, text, colour, alpha = 1) {
      g.save();
      g.globalAlpha = alpha;
      g.fillStyle = colour;
      g.beginPath();
      g.moveTo(x - 14, y - 22); g.lineTo(x + 14, y - 22); g.lineTo(x, y); g.closePath();
      g.fill();
      // Under the name and the count a name would sit on them: the pointer
      // alone there. At the frame's edge the name stays inside it.
      if (text && y - 80 >= 560) {
        g.font = font(800, 34);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const w = g.measureText(text).width + 36;
        const W = g.canvas.width;
        const cx = Math.max(w / 2 + 12, Math.min(W - w / 2 - 12, x));
        pill(g, cx - w / 2, y - 80, w, 52, BG);
        g.fillStyle = colour;
        g.fillText(text, cx, y - 53);
      }
      g.restore();
    },
    /** Kill feed rows centred from y down: [{ killer, weapon, victim, kc, vc, alpha }]. */
    feed(g, W, y, rows) {
      g.save();
      g.textBaseline = 'middle';
      for (const [i, r] of rows.entries()) {
        g.globalAlpha = r.alpha;
        g.font = font(800, 38);
        const wk = g.measureText(r.killer).width;
        const wv = g.measureText(r.victim).width;
        g.font = font(700, 28);
        const ww = r.weapon ? g.measureText(r.weapon).width + 28 : 0;
        const gap = 18;
        const w = wk + wv + ww + gap * 2 + 44;
        const yy = y + i * 64;
        pill(g, W / 2 - w / 2, yy - 28, w, 56, BG);
        let x = W / 2 - w / 2 + 22;
        g.textAlign = 'left';
        g.font = font(800, 38);
        g.fillStyle = r.kc;
        g.fillText(r.killer, x, yy + 2);
        x += wk + gap;
        if (r.weapon) {
          pill(g, x, yy - 18, ww, 36, 'rgba(246,241,226,0.16)');
          g.font = font(700, 28);
          g.fillStyle = 'rgba(246,241,226,0.85)';
          g.fillText(r.weapon, x + 14, yy + 2);
          x += ww + gap;
        }
        g.font = font(800, 38);
        g.fillStyle = r.vc;
        g.fillText(r.victim, x, yy + 2);
      }
      g.restore();
      g.textAlign = 'center';
    },
    /** Two lines of large text over the lower middle, outlined to read on
     *  any ground; parts [{ text, colour }] per line. */
    caption(g, W, y, lines, alpha = 1) {
      g.save();
      g.globalAlpha = alpha;
      g.textBaseline = 'middle';
      for (const [i, parts] of lines.entries()) {
        // A long name ("[TRIBUNAL] Kast7n ends it") is set smaller to fit.
        let px = i === 0 ? 72 : 44;
        g.font = font(i === 0 ? 900 : 700, px);
        const wide = parts.reduce((a, p) => a + g.measureText(p.text).width, 0);
        if (wide > W - 96) {
          px = Math.floor((px * (W - 96)) / wide);
          g.font = font(i === 0 ? 900 : 700, px);
        }
        const widths = parts.map(p => g.measureText(p.text).width);
        let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
        const yy = y + (i === 0 ? 0 : 84);
        g.textAlign = 'left';
        g.lineJoin = 'round';
        g.lineWidth = i === 0 ? 12 : 9;
        g.strokeStyle = 'rgba(8,8,6,0.85)';
        for (const [j, p] of parts.entries()) {
          g.strokeText(p.text, x, yy);
          g.fillStyle = p.colour ?? INK;
          g.fillText(p.text, x, yy);
          x += widths[j];
        }
      }
      g.restore();
      g.textAlign = 'center';
    },
  };
})();`;

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
const MAP_CARD = Object.freeze({ gap: 20, frames: 30, fade: 4, drawFrom: 4, drawTo: 24, samples: 48, moved: 80 });
/** A plane's route is a squiggle and says little (the owner, 2026-11-04):
 *  no card for one. A card only when he has moved `moved` metres. */
async function mapCard(page, reel, a, b, { shown = 0 } = {}) {
  return page.evaluate(async ({ W, H, pid, t0, t1, card, name, top, shown: cardsBefore }) => {
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
    // How far he went (in map units, then metres by the projection's scale).
    let length = 0;
    for (let i = 1; i < route.length; i++) length += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    const metres = length / Math.max(1e-9, Math.hypot(m[0], m[3]));
    // A man who stayed put has no route to show (rafal_pl's bunker drew a dot
    // and "+1:20", 2026-11-04): no card, the first included.
    if (metres < card.moved) return null;
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
  }, { W, H, pid: reel.player, t0: a.t, t1: b.t, card: MAP_CARD, name: reel.playerName ?? '', top: OVERLAY_TOP, shown });
}

/** Each part's sound starts JCUT frames before its picture, under the last
 *  of the dip before it (EDITS.md, the J-cut). */
const JCUT = 8;
function jCut(audio) {
  for (let i = 1; i < audio.length; i++) {
    const lead = JCUT / FPS;
    const [prev, next] = [audio[i - 1], audio[i]];
    if (prev[1] - prev[0] < 1 || next[1] - next[0] < 1) continue;
    // A slowed range (third entry, one per frame) gives up its last frames'
    // sound and takes on the next's first at 1x.
    if (next[2]) next[2] = [...Array(JCUT).fill(1 / FPS), ...next[2]];
    next[0] -= lead;
    if (prev[2]) prev[1] -= prev[2].splice(-JCUT).reduce((a, b) => a + b, 0);
    else prev[1] -= lead;
  }
}

/** A part's frames out through the dip: `{ frames, dropped }`. */
async function dipOut(page, urls) {
  const all = urls.map((_, i) => i);
  if (urls.length < DIP.ramp + DIP.out + 4) return { frames: urls, dropped: 0, kept: all };
  const head = urls.slice(0, urls.length - DIP.ramp - DIP.out);
  const keep = (_, i) => i % 3 !== 2;
  const ramp = urls.slice(urls.length - DIP.ramp - DIP.out, urls.length - DIP.out).filter(keep);
  const kept = [...all.slice(0, head.length), ...all.slice(head.length, urls.length - DIP.out).filter(keep), ...all.slice(urls.length - DIP.out)];
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
  return { frames: [...head, ...ramp, ...tail], dropped, kept };
}

/**
 * The camera's rules for a take (the owner, 2026-11-04: "we need rules that
 * say how to control the camera ... tighter, almost at their POV"). After the
 * chase places the camera each frame, the director checks the level hides
 * neither the shooter nor where he is firing (his eye, and `reach` metres
 * along his latest recorded shot, else at whoever he next kills). If one is
 * hidden it eases (`ease` seconds) to the first clear of: over his shoulder
 * close (`shoulder`: back, up, right), then his own eyes (`eyes`), and holds
 * it at least `hold` seconds before it may go back.
 */
const DIRECTOR = Object.freeze({
  reach: 40, ease: 0.3, hold: 1.5, eye: 1.6, hullEye: 2.4, near: 0.35, beyond: 5,
  // The flight: the share of the picture within flightNear metres that cuts
  // to the reverse, `reverse` [back, up] from the victim.
  flightNear: 3, flightShare: 0.45, reverse: [3.5, 0.9],
  // ...and from behind a hull it kills (a PIAT on a Tiger, 2026-11-09) much
  // farther and higher: at 3.5 m the lens sat on the hull and the hit filled
  // the frame with fire. The hit itself is then the round cam's hull hold,
  // which draws back by the hull's radius.
  hullReverse: [14, 5],
  // The flight also turns to the reverse when the man it kills is hidden
  // (a bunker 12 m off, 2026-11-04): something drawn `hidden` metres or more
  // short of him at his pixel, `farther` metres or more from the lens, on
  // two probes running.
  hidden: 2, farther: 4,
  // A picture that is all wall (`wall` of it within `wallFar` metres) is
  // blocked too. When the reverse is as blocked (he died in the bunker), the
  // crane: `crane` [back, up] metres over the shooter, looking at him.
  wallFar: 8, wall: 0.75, crane: [7, 8],
  // A gunner on a big hull: the chase follows the hull, which on the Prince
  // of Wales is 145 m from his AA mount, and the page's ear goes with the
  // camera (his gun was all but silent, 2026-11-04). When his shots leave
  // more than `mountFar` metres from the point the chase follows, his eye is
  // the mount that fired and the pose at least over his shoulder.
  mountFar: 15,
  // A plane it kills is chased from outside, as the game's F10 view (the
  // owner, 2026-11-04: the Tiger's round took the camera into a Spitfire's
  // cockpit): `f10` [back, up] in the plane's bounding radii plus metres,
  // once the round's camera is within `f10From` metres of the plane.
  f10: [2.5, 6, 0.8, 2], f10From: 60,
  shoulder: [2.0, 0.45, 0.6], side: [0.3, 0.2, 2.2], eyes: [0.15, 0.05, 0],
  // A one-take burst needs the chase as placed for this share of it: one the
  // director had to keep closing in on is cramped (inside a church: the camera
  // sat in his backpack) and goes kill by kill.
  roomy: 0.6,
});
/**
 * The shooter seen at last (`reveal` in the director). A take counts as
 * having shown him when he is inside `frame` of the picture (NDC) and at
 * least `tall` of its height (`manSize` metres for a man, `hullSize` for a
 * hull) for `seen` frames. One that did not, of a kill `minDist` metres or
 * more, flies back up the round's path once the hold ends: a `beat` on the
 * fallen man, then `flyBase + metres / flyPerM` seconds (clamped to
 * `flyMin`..`flyMax`) over an arc `arcPerM` of the distance high (clamped),
 * at least `clear` metres off the ground midway, turned onto him over the
 * first `turn` of it, to the first clear of `ends` ([ahead toward his
 * victim, side, up] metres from his eye, times `hullScale` for a hull), else
 * `crane`; held `hold` seconds, then the look's fade. The fly from
 * `probeFrom` of the way on is checked in `probes` steps against the depth
 * picture; the first step into the level stops it `cutBack` steps short and
 * cuts to the end.
 */
const REVEAL = Object.freeze({
  frame: 0.9, tall: 0.12, manSize: 1.8, hullSize: 4, seen: 20, minDist: 25,
  eye: 1.3, hullEye: 1.8, hullScale: 3,
  beat: 0.35, flyBase: 1, flyPerM: 300, flyMin: 1.3, flyMax: 2.4,
  arcPerM: 0.06, arcMin: 3, arcMax: 20, clear: 2.5, turn: 0.35, hold: 2, probeFrom: 0.3, probes: 28, cutBack: 1,
  ends: [[4.5, 1.4, 0.2], [4.5, -1.4, 0.2], [3, 2.6, 1.8], [-2.2, 0.8, 0.6]],
  crane: [-7, 0, 8],
});

/** A small depth picture of the scene from the camera as it stands, for
 *  judging what is in front of the lens (`window.__depth`): `near(d)` the
 *  share of it closer than `d` metres; `at(p)` the distance drawn at world
 *  point `p`'s pixel, or Infinity off the picture. */
const DEPTH_SRC = `window.__depth = (() => {
  const W = 72, H = 128;
  let T = null, rt = null, mat = null;
  const buf = new Uint8Array(W * H * 4);
  let dist = new Float32Array(W * H);
  return {
    async ready() {
      T ??= await import('three');
      rt ??= new T.WebGLRenderTarget(W, H);
      mat ??= new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    },
    take(cam) {
      if (!T) return false;
      const r = window.replay;
      const scene = r.ctx.scene;
      const gl = window.__renderer;
      const before = gl.getRenderTarget();
      const over = scene.overrideMaterial;
      cam.updateMatrixWorld();
      scene.overrideMaterial = mat;
      gl.setRenderTarget(rt);
      gl.render(scene, cam);
      gl.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      gl.setRenderTarget(before);
      scene.overrideMaterial = over;
      const n = cam.near, f = cam.far;
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        // three r169 packs the most significant byte first (red).
        const d = buf[o] / 255 + buf[o + 1] / 255 / 256 + buf[o + 2] / 255 / (256 * 256) + buf[o + 3] / 255 / (256 * 256 * 256);
        dist[i] = d >= 0.9999 ? Infinity : (n * f) / ((f - n) * d - f) * -1;
      }
      return true;
    },
    near(d) {
      let k = 0;
      for (let i = 0; i < dist.length; i++) if (dist[i] < d) k++;
      return k / dist.length;
    },
    /** The share of the picture's top \`frac\` closer than \`d\` metres: walls
     *  and roofs where the action plays (its bottom is the ground at his feet). */
    nearTop(d, frac = 2 / 3) {
      let k = 0, n = 0;
      for (let y = Math.floor(H * (1 - frac)); y < H; y++) {
        for (let x = 0; x < W; x++) { n++; if (dist[y * W + x] < d) k++; }
      }
      return n ? k / n : 0;
    },
    at(p, cam) {
      const v = p.clone().project(cam);
      if (!(v.z < 1) || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return Infinity;
      const x = Math.min(W - 1, Math.max(0, Math.round((v.x + 1) / 2 * (W - 1))));
      const y = Math.min(H - 1, Math.max(0, Math.round((v.y + 1) / 2 * (H - 1))));
      return dist[y * W + x];
    },
  };
})();`;

const DIRECTOR_SRC = `window.__director = (() => {
  let state = null;
  const T = () => window.__three;
  const clear = (collider, a, b) => {
    if (!collider?.cast) return true;
    const d = b.clone().sub(a);
    const dist = d.length();
    if (dist < 1) return true;
    d.divideScalar(dist);
    const moving = collider.dynamicCast;
    collider.dynamicCast = null;
    try { return !collider.cast(a.x, a.y, a.z, d.x, d.y, d.z, dist - 0.8, -1, 0, 0); } finally { collider.dynamicCast = moving; }
  };
  return {
    install(pid, victims = [], cfg, { chain = null, when = null, flight = null } = {}) {
      const r = window.replay;
      const B = window.__rbSync;
      const cam = r.ctx.camera;
      state = { pid, victims, cfg, pose: 0, w: 0, held: 0, last: null, frames: [0, 0, 0, 0, 0], chain };
      const V = (x = 0, y = 0, z = 0) => cam.position.clone().set(x, y, z);
      // F10: behind the plane along its flight and above, eased in, held
      // through the hit; true while it places the camera.
      state.f10Chase = c => {
        const st = state;
        const ro = r.creator.rounds;
        const hold = ro?.victimHold?.();
        const root = hold?.hull?.root;
        if (!root) return false;
        const P = V();
        root.getWorldPosition(P);
        if (!Number.isFinite(P.x)) return false;
        if (!st.f10On) {
          if (ro.state !== 'impact' && c.position.distanceTo(P) > st.cfg.f10From) { st.f10Last = P; return false; }
          st.f10On = true;
          st.f10W = 0;
        }
        const move = st.f10Last ? P.clone().sub(st.f10Last) : V();
        st.f10Last = P.clone();
        if (move.lengthSq() > 1e-4) st.f10Dir = (st.f10Dir ?? move.clone().normalize()).lerp(move.normalize(), 0.2).normalize();
        const dir = st.f10Dir ?? P.clone().sub(c.position).setY(0).normalize();
        const rad = hold.reach || 4;
        const [kb, mb, ku, mu] = st.cfg.f10;
        const at = P.clone().addScaledVector(dir, -(kb * rad + mb)).add(V(0, ku * rad + mu, 0));
        const look = P.clone().addScaledVector(dir, rad);
        st.f10W = Math.min(1, (st.f10W ?? 0) + 1 / (st.cfg.ease * 30));
        const e = st.f10W * st.f10W * (3 - 2 * st.f10W);
        const q = new (c.quaternion.constructor)().setFromRotationMatrix(new (c.matrixWorld.constructor)().lookAt(at, look, V(0, 1, 0)));
        c.position.lerp(at, e);
        c.quaternion.slerp(q, e);
        c.updateMatrixWorld();
        c.matrixWorldInverse.copy(c.matrixWorld).invert();
        st.frames[4]++;
        return true;
      };
      // The shooter seen at last (the owner, 2026-11-09, a 294 m K98 on
      // Midway filmed from behind the man it killed: "the shooter is off
      // screen almost, I can't even see them ... we need to zoom into the
      // shooter at the end"). Through the take it counts the frames he is in
      // the picture and tall enough to make out; a take that never showed
      // him flies back up the round's path when the hold ends, onto him from
      // the front, and holds there to the fade. The clip's out point moves
      // with it.
      const reveal = c => {
        const st = state;
        const R = st?.cfg?.reveal;
        if (!R || !flight || flight.air || flight.fromAir) return;
        const rv = (st.rv ??= { seen: 0 });
        if (rv.over) return;
        const ro = r.creator.rounds;
        const sw = B.whereIs(r.rec, st.pid, r.time, r.kills ?? r.rec.kills);
        if (!sw?.pos) return;
        const hull = sw.state === 'vehicle';
        const E = V(sw.pos[0], sw.pos[1] + (hull ? R.hullEye : R.eye), sw.pos[2]);
        const rec = r.creator.recorder;
        const holdOpen = at => {
          if (!rec?.started || rec.t1 >= at) return;
          rec.t1 = at;
          r.creator.range.out = at;
        };
        if (!rv.on) {
          const s = ro?.state;
          if (s === 'armed' || s === 'flying' || s === 'impact') {
            const d = Math.max(0.5, c.position.distanceTo(E));
            const v = E.clone().project(c);
            const tall = (hull ? R.hullSize : R.manSize) / (2 * d * Math.tan((c.fov * Math.PI) / 360));
            if (v.z < 1 && Math.abs(v.x) < R.frame && Math.abs(v.y) < R.frame && tall >= R.tall) rv.seen++;
            if (s === 'impact') rv.impact = true;
            // The hold may run past the clip's end: keep it open for the reveal.
            if (rv.impact && rv.seen < R.seen) holdOpen(r.time + 0.4);
            return;
          }
          if (!rv.impact) return;
          if (rv.seen >= R.seen) { rv.over = true; return; }
          const vw = B.whereIs(r.rec, flight.victim, (flight.t ?? r.time) - 0.1, r.kills ?? r.rec.kills);
          const vic = vw?.pos ? V(vw.pos[0], vw.pos[1] + 1, vw.pos[2]) : null;
          const far = vic ? vic.distanceTo(E) : 0;
          if (far < R.minDist) { rv.over = true; return; }
          // Where it ends: in front of him (toward the man he killed), off
          // to one side, the first pose the depth picture says sees him.
          const fwd = vic.clone().sub(E).setY(0).normalize();
          const right = V(-fwd.z, 0, fwd.x);
          const k = hull ? R.hullScale : 1;
          const D = window.__depth;
          const saved = [c.position.clone(), c.quaternion.clone()];
          const offsets = R.ends.map(([a, s, u]) => [a * k, s * k, u * k]);
          const at = ([a, s, u]) => E.clone().addScaledVector(fwd, a).addScaledVector(right, s).add(V(0, u, 0));
          let pick = null;
          for (const o of offsets) {
            const p = at(o);
            c.position.copy(p);
            c.lookAt(E);
            c.updateMatrixWorld();
            D.take(c);
            if (D.at(E, c) >= p.distanceTo(E) - 0.8 && D.near(1.2) < 0.25) { pick = o; break; }
          }
          c.position.copy(saved[0]);
          c.quaternion.copy(saved[1]);
          c.updateMatrixWorld();
          rv.end = pick ?? R.crane.map(x => x * k);
          rv.on = true;
          rv.t0 = r.time;
          rv.from = saved[0];
          rv.path = (e, A) => {
            const P = rv.from.clone().lerp(A, e).add(V(0, rv.arc * Math.sin(Math.PI * e), 0));
            const g = r.ctx.groundHeight?.(P.x, P.z);
            if (Number.isFinite(g)) P.y = Math.max(P.y, g + R.clear * Math.sin(Math.PI * e));
            return P;
          };
          rv.q0 = saved[1];
          rv.fwd = fwd;
          rv.right = right;
          rv.fly = Math.min(R.flyMax, Math.max(R.flyMin, R.flyBase + far / R.flyPerM));
          rv.arc = Math.min(R.arcMax, Math.max(R.arcMin, far * R.arcPerM));
          rv.far = far;
          // The way in, judged by the depth picture a step at a time over
          // the last part of the fly: where a step would pass through the
          // level (he is in a bunker), the fly stops short there and cuts to
          // the end pose (the first try flew a second through concrete).
          const Aend = E.clone().addScaledVector(fwd, rv.end[0]).addScaledVector(right, rv.end[1]).add(V(0, rv.end[2], 0));
          rv.cutAt = null;
          let prev = rv.path(R.probeFrom, Aend);
          for (let i = 1; i <= R.probes; i++) {
            const e = R.probeFrom + ((1 - R.probeFrom) * i) / R.probes;
            const p = rv.path(e, Aend);
            c.position.copy(prev);
            c.lookAt(p);
            c.updateMatrixWorld();
            D.take(c);
            if (D.at(p, c) < prev.distanceTo(p) - 0.3) { rv.cutAt = R.probeFrom + ((1 - R.probeFrom) * Math.max(0, i - 1 - R.cutBack)) / R.probes; break; }
            prev = p;
          }
          c.position.copy(saved[0]);
          c.quaternion.copy(saved[1]);
          c.updateMatrixWorld();
          holdOpen(r.time + R.beat + rv.fly + R.hold + (r.creator.edits?.fadeOut || 0));
          (st.flog ??= []).push('reveal ' + far.toFixed(0) + ' m seen ' + rv.seen + ' end ' + (pick ? offsets.indexOf(pick) : 'crane') + (rv.cutAt !== null ? ' cut ' + rv.cutAt.toFixed(2) : ''));
        }
        // The fly: eased from where the hold left the lens to the end pose,
        // over an arc that clears the ground, looking at him all the way.
        const [a, s, u] = rv.end;
        const A = E.clone().addScaledVector(rv.fwd, a).addScaledVector(rv.right, s).add(V(0, u, 0));
        const x = Math.min(1, Math.max(0, (r.time - rv.t0 - R.beat) / rv.fly));
        const e = x * x * x * (x * (x * 6 - 15) + 10);
        const cut = rv.cutAt !== null && e >= rv.cutAt;
        const P = cut ? A : rv.path(rv.cutAt !== null ? Math.min(e, rv.cutAt) : e, A);
        const q = new (c.quaternion.constructor)().setFromRotationMatrix(new (c.matrixWorld.constructor)().lookAt(P, E, V(0, 1, 0)));
        const w = cut ? 1 : Math.min(1, e / R.turn);
        c.position.copy(P);
        c.quaternion.copy(rv.q0).slerp(q, w * w * (3 - 2 * w));
        c.updateMatrixWorld();
        c.matrixWorldInverse.copy(c.matrixWorld).invert();
      };
      r.camera.setLensHook(c => {
        place(c);
        reveal(c);
      });
      const place = c => {
        const st = state;
        // The hook the page had (the creator's lens) runs first.
        st?.chain?.(c);
        if (!st) return;
        // The round in flight: as placed behind it, unless the level fills
        // the picture (a church's walls); then from behind the man it kills,
        // looking back up its path, held to the hit.
        if ((flight && flight()) || st.lastResort) {
          const D = window.__depth;
          st.ftick = (st.ftick ?? -1) + 1;
          if (flight?.air && !st.lastResort && st.f10Chase(c)) return;
          // A bomb from a plane is the round cam's own (replay-roundcam.js
          // DROP): just after release the plane fills the lens, and the
          // reverse put the camera under the bomb on the man it killed (the
          // owner, 2026-11-04, skandia's 109: "way too tight on the victim").
          if (flight?.fromAir && !st.lastResort) return;
          if (st.ftick % 4 === 0 && !st.reverse && !st.noReverse) {
            D.take(c);
            if (D.near(st.cfg.flightNear) > st.cfg.flightShare || D.near(st.cfg.wallFar) > st.cfg.wall) st.reverse = true;
            // The man it kills hidden behind something (not the shooter's
            // own hull at the lens) on two probes running.
            const hw = B.whereIs(r.rec, flight.victim, Math.min(r.time, (flight.t ?? Infinity) - 0.1), r.kills ?? r.rec.kills);
            if (hw?.pos && !flight.air) {
              const vp = V(hw.pos[0], hw.pos[1] + 1.1, hw.pos[2]);
              const far = c.position.distanceTo(vp);
              const drawn = D.at(vp, c);
              const hid = Number.isFinite(drawn) && drawn < far - st.cfg.hidden && drawn > st.cfg.farther;
              st.hid = hid ? (st.hid ?? 0) + 1 : 0;
              (st.flog ??= []).push([st.ftick, +D.near(st.cfg.flightNear).toFixed(2), +D.near(st.cfg.wallFar).toFixed(2), +(Number.isFinite(drawn) ? drawn : -1).toFixed(1), +far.toFixed(1)]);
              if (st.hid >= 2) st.reverse = true;
            }
          }
          if (!st.reverse) return;
          // A hull struck: the round cam's own hold draws back from it.
          if (flight.victimHull && r.creator.rounds?.state === 'impact') return;
          const vw = B.whereIs(r.rec, flight.victim, Math.min(r.time, (flight.t ?? Infinity) - 0.1), r.kills ?? r.rec.kills);
          const sw = B.whereIs(r.rec, st.pid, r.time, r.kills ?? r.rec.kills);
          if (!vw?.pos || !sw?.pos) return;
          const vic = V(vw.pos[0], vw.pos[1] + 1.1, vw.pos[2]);
          const from = V(sw.pos[0], sw.pos[1] + 1.4, sw.pos[2]);
          const back = vic.clone().sub(from).setY(0).normalize();
          const rev = flight.victimHull ? st.cfg.hullReverse : st.cfg.reverse;
          let at = vic.clone().addScaledVector(back, rev[0]).add(V(0, rev[1], 0));
          let look = from.clone().lerp(vic, 0.6);
          // The reverse judged once: it must see the man it kills and not be
          // all wall; else the crane over the shooter, if that sees him; else
          // no reverse at all, the chase rides on (the owner, 2026-11-05:
          // Tyson in a landing craft on Omaha, filmed from behind him, the
          // craft's ramp filling the picture for six seconds).
          if (st.crane === undefined) {
            const saved = [c.position.clone(), c.quaternion.clone()];
            const sees = (p, l) => {
              c.position.copy(p);
              c.lookAt(l);
              c.updateMatrixWorld();
              D.take(c);
              return D.near(st.cfg.wallFar) <= st.cfg.wall && D.at(vic, c) >= p.distanceTo(vic) - 1;
            };
            const craneAt = from.clone().addScaledVector(back, -st.cfg.crane[0]).add(V(0, st.cfg.crane[1], 0));
            if (sees(at, look)) st.crane = false;
            else if (sees(craneAt, vic)) st.crane = true;
            else {
              st.reverse = false;
              st.noReverse = true;
              c.position.copy(saved[0]);
              c.quaternion.copy(saved[1]);
              c.updateMatrixWorld();
              c.matrixWorldInverse.copy(c.matrixWorld).invert();
              (st.flog ??= []).push('no clear reverse');
              return;
            }
          }
          if (st.crane) {
            at = from.clone().addScaledVector(back, -st.cfg.crane[0]).add(V(0, st.cfg.crane[1], 0));
            look = vic;
          }
          c.position.copy(at);
          c.lookAt(look);
          c.updateMatrixWorld();
          c.matrixWorldInverse.copy(c.matrixWorld).invert();
          st.frames[4]++;
          return;
        }
        if (st.reverse) st.reverse = false;
        if (when && !when()) return;
        st.lastResort = false;
        // A pilot's shot before it leaves is the round cam's own (behind and
        // above the plane, in its radii): the shoulder and eye poses sit inside
        // a 109, and their last resort put the camera on the ground under the
        // bomb (skandia's kills 3 and 4 on Battleaxe, 2026-11-04).
        if (flight?.fromAir) return;
        const t = r.time;
        const w = B.whereIs(r.rec, st.pid, t, r.kills ?? r.rec.kills);
        if (!w?.pos) return;
        // Him as the replay draws him: the point the chase camera follows (on a
        // fixed gun the recorded position is the mount's, and poses built on it
        // framed empty air), else his recorded place.
        const drawn = r.camera.targetAt?.(t)?.point;
        let eye = drawn ? V(drawn.x, drawn.y + (w.state === 'vehicle' ? 0.8 : 0.4), drawn.z)
          : V(w.pos[0], w.pos[1] + (w.state === 'vehicle' ? st.cfg.hullEye : st.cfg.eye), w.pos[2]);
        // Where he fires: his latest shot's line, else his next victim.
        let aim = null;
        let mount = null;
        const fires = r.rec.fires ?? [];
        for (let i = fires.length - 1; i >= 0; i--) {
          const f = fires[i];
          if (f.t > t) continue;
          if (t - f.t > 2) break;
          if (f.pid === st.pid && Array.isArray(f.dir)) {
            aim = V(f.dir[0], f.dir[1], -f.dir[2]).normalize();
            if (Array.isArray(f.pos)) mount = V(f.pos[0], f.pos[1], -f.pos[2]);
            break;
          }
        }
        // His gun far from what the chase follows (a ship's mount): from it.
        st.atMount = Boolean(mount && eye.distanceTo(mount) > st.cfg.mountFar);
        if (st.atMount) eye = mount.clone().add(V(0, 0.8, 0));
        if (!aim) {
          const next = st.victims.find(v => v.t >= t - 0.5) ?? st.victims.at(-1);
          const vw = next ? B.whereIs(r.rec, next.pid, Math.min(t, next.t), r.kills ?? r.rec.kills) : null;
          aim = vw?.pos ? V(vw.pos[0], vw.pos[1] + 1, vw.pos[2]).sub(eye).normalize() : V(0, 0, -1).applyQuaternion(c.quaternion);
        }
        const target = eye.clone().addScaledVector(aim, st.cfg.reach);
        // A pose is clear when little of the picture from it stands closer
        // than him: a wall or a roof in front of the lens fills it.
        const D = window.__depth;
        const probe = (p, look) => {
          const saved = [c.position.clone(), c.quaternion.clone()];
          c.position.copy(p);
          c.lookAt(look);
          D.take(c);
          // He must be in the picture, nothing in front of him, and the scene
          // round him open: little of its top within st.cfg.beyond of him.
          const toEye = p.distanceTo(eye);
          const seen = D.at(eye, c) >= toEye - 0.8;
          const reach = toEye;
          const share = seen ? D.nearTop(toEye + st.cfg.beyond) : 1;
          (st.log ??= []).push([p === c.position ? 0 : 1, +share.toFixed(2), +reach.toFixed(1)]);
          c.position.copy(saved[0]);
          c.quaternion.copy(saved[1]);
          c.updateMatrixWorld();
          return share < st.cfg.near;
        };
        const ok = p => probe(p, p === c.position ? eye.clone().addScaledVector(aim, 4) : target);
        // The poses: 0 the chase as placed, 1 close over his shoulder, 2 his eyes.
        const flat = V(aim.x, 0, aim.z);
        if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
        flat.normalize();
        const right = V(-flat.z, 0, flat.x);
        // The poses: 0 the chase as placed, 1 close over his shoulder, 2 and 3
        // across at him and his gun from either side (the gun firing is the
        // picture: only it need be clear), 4 his eyes.
        const gun = eye.clone().addScaledVector(aim, 1.2);
        const poseAt = k => {
          const [back, up, side] = k === 1 ? st.cfg.shoulder : k === 2 || k === 3 ? st.cfg.side : st.cfg.eyes;
          return eye.clone().addScaledVector(flat, -back).add(V(0, up, 0)).addScaledVector(right, k === 3 ? -side : side);
        };
        const lookOf = k => (k === 2 || k === 3 ? gun : target);
        const sees = (p, k) => probe(p, lookOf(k));
        st.tick = (st.tick ?? -1) + 1;
        const want = st.tick % 6 !== 0 ? st.want ?? 0
          : (st.want = st.atMount ? [1, 2, 3].find(k => sees(poseAt(k), k)) ?? 4
            : ok(c.position) ? 0 : [1, 2, 3].find(k => sees(poseAt(k), k)) ?? 4);
        // Not even his eyes see past the wall in front of him: the victim's side.
        if (want === 4 && st.tick % 6 === 0 && flight?.victim !== undefined && !st.noReverse && !probe(poseAt(4), target)) {
          st.lastResort = true;
          st.reverse = true;
          return;
        }
        st.held += 1 / 30;
        if (want > st.pose || (want < st.pose && st.held >= st.cfg.hold)) {
          st.pose = want;
          st.held = 0;
        }
        st.frames[st.pose]++;
        const goal = st.pose > 0 ? 1 : 0;
        // The take's first frame takes its pose at once: no ease in from a wall.
        if (st.first === undefined) { st.first = true; st.w = goal; }
        st.w += (goal - st.w) * (1 - Math.exp(-1 / (st.cfg.ease * 30)));
        if (st.w < 0.01) return;
        const k = Math.max(1, st.pose);
        const at = poseAt(k);
        const look = new (c.quaternion.constructor)();
        const m = new (c.matrixWorld.constructor)().lookAt(at, lookOf(k), V(0, 1, 0));
        look.setFromRotationMatrix(m);
        c.position.lerp(at, st.w);
        c.quaternion.slerp(look, st.w);
        c.updateMatrixWorld();
        c.matrixWorldInverse.copy(c.matrixWorld).invert();
      };
    },
    log() { return state?.log ?? []; },
    flightLog() { return [...(state?.flog ?? []), state?.reverse ? 'reverse' : 'chase', state?.crane ? 'crane' : '', state?.f10On ? 'f10' : ''].slice(-14); },
    /** The share of the take's frames at each pose, 0 chase .. 4 his eyes. */
    shares() {
      const f = state?.frames ?? [1, 0, 0, 0, 0];
      const n = f.reduce((a, b) => a + b, 0) || 1;
      return f.map(x => x / n);
    },
    remove() {
      const chain = state?.chain ?? null;
      state = null;
      window.replay.camera.setLensHook(chain);
    },
  };
})();`;

/** Seconds the streak's closing card holds, after its fade in. */
const STREAK_CARD = 2.2;

const REEL_BEAT = Object.freeze({
  top: OVERLAY_TOP,
  lead: 4, slow: 0.35, hold: 1.8, grey: 0.4, fade: 0.35, volleyLead: 5, volleyHold: 2.4, playerLead: 3.5, playerHold: 2.2,
  // A volley stays behind the killer through the kill: the clock eases from
  // 1x to volleySlow over the volleyEase seconds of round before it, so the
  // last rounds of the burst fly slowly as the kill lands, and the lens
  // widens (up to volleyFov degrees) only when his victim would leave the
  // frame's middle volleyFit of it.
  volleySlow: 0.5, volleyEase: 0.7, volleyFov: 80, volleyFit: 0.8,
  // When the victim sits behind the killer's own plane on screen (dead ahead
  // on the chase line), the eye rises volleyLift metres, eased over
  // volleyLiftTime seconds, and stays up for the part.
  volleyLift: 3, volleyLiftTime: 0.4,
  man: [6, 8], hull: [26, 9], behind: 5, up: 3.5,
});

/**
 * One ASMR moment (picker `asmrMomentsOf`, `underFireMomentsOf`): real time,
 * the game's own sound, the weapon's name small at the top, in from black
 * and out through the dip. The owner, 2026-11-07: "for these shorts we don't
 * want slo mo, it's like a tribute to the beauty of the game, so don't edit
 * it". The slow tail of 2026-11-04 and its echo, bass and compression are
 * gone; the sound is only faded in and levelled (`ASMR_SOUND`). A moment of
 * fire is seen from downrange, facing the gun (`FACING_CAM`, his favourite:
 * The Clëäner's flak gun firing at the lens); an under-fire moment from the
 * ground at the base of the hits (`UNDER_FIRE_CAM`). Frames go to `write`;
 * returns its stretch of the sound.
 */
/** ASMR's sound: in from quiet over half a second, levelled loudness. */
const ASMR_SOUND = 'afade=t=in:d=0.5,loudnorm=I=-14:TP=-1.5:LRA=11';
/** ASMR's pace: real time throughout (no slow tail). Kept for the loop's
 *  shape; `slowFrom` is never reached. */
const ASMR_PACE = Object.freeze({ slow: 1, ease: 0.4, hold: Infinity });
/**
 * Facing the gun: downrange of it, off its line of fire, looking back at it
 * as it fires, so its report comes at the lens and its rounds crack past.
 * A man's gun: `man` [out, side, up] metres from the muzzle along his aim; a
 * hull's: `hull` (at 16 m a tank sat small in the frame; the flak gun he
 * liked was a few metres off). Eased (`ease` a frame). Blocked (the depth
 * probe: the lens in a wall, or the gun hidden behind something drawn short
 * of its muzzle on two probes running), it crosses to his other side, then
 * rises (`high`); still blocked, or more than `spoilt` of it white or black
 * (`black`: a smoke puff at the lens), left out.
 * A gun's crack opens 75 ms out, about 55 m, so from here the gun's report
 * is the sound and its rounds seldom crack.
 */
const FACING_CAM = Object.freeze({ man: [5, 1.8, 0.3], hull: [10, 3.5, 1.0], high: 4, black: 0.06, ease: 0.08, look: 0.6, ground: 0.4,
  near: 0.7, wall: 0.45, blockedAt: 3, blocked: 0.6, top: 0.5, clip: 0.4, fov: 62, white: 0.82, spoilt: 0.06 });

/** Each frame kept by the dip, the seconds of the round's sound it plays:
 *  its pace over the frame, a dropped frame's on the frame before it, scaled
 *  to the `total` the render ran. */
function slowedSound(paces, kept, total) {
  const adv = kept.map((k, j) => {
    let s = 0;
    for (let i = k; i < (kept[j + 1] ?? paces.length); i++) s += paces[i] / FPS;
    return s;
  });
  const sum = adv.reduce((a, b) => a + b, 0) || 1;
  return adv.map(a => a * total / sum);
}

/**
 * Under fire (picker `underFireMomentsOf`, the owner, 2026-11-07): the man
 * the rounds go past, heard where he is. The page's ear is the camera, and a
 * round's crack sounds only within about 10 m of it (`passing-rounds.js`).
 * The owner's style is the ground at the base of the hits ("Band of Brothers
 * ... the soldiers are under fire and it makes this nice thumping sound of
 * the bullets hitting the ground ... deliberately putting itself at the base
 * of bullet hits"): the camera lies `low` over the ground beside him,
 * `groundBack` behind and `groundSide` to his side, away from the men firing
 * at him and looking along the ground at them, so the rounds strike between
 * him and the lens and their impacts (a stone ricochet sounds within 25 m,
 * wood and metal 10) thump close while the cracks go over. It looks
 * `frameHim` of the way from the guns to him, so he stands in the picture
 * with the fire beyond him, and draws nothing nearer than `clip` metres: the
 * dust of a hit at the lens filled the frame white (Savoy, 2026-11-07). A
 * take whose frames run white (mean over `white`, for `whiteShare` of it) is
 * left out. Blocked there, it rises to his shoulder (`back` behind, `up`
 * over his eye). Who he is looking at is the
 * shooters of the passes within `window` seconds, eased (`ease` a frame).
 * When the depth probe finds the lens in a wall (`wall` of the picture
 * nearer than `near` m) or the picture blocked (`blocked` of it nearer than
 * `blockedAt` m in its `top` half, where the guns are: his own back and the
 * ground at his feet fill the bottom), it rises a step: from the ground to
 * his shoulder, then over him (`overBack` behind, `overUp` over his eye: over
 * the parapet of his trench); a take still blocked there is left out, and
 * so is one with fewer than `cracks` cracks and `thumps` impacts heard (a hull's gun the replay fires from its drawn barrel can
 * miss the man the recording's line went past). A man's place is at his
 * feet: `eye` and `aim` are over it.
 */
const UNDER_FIRE_CAM = Object.freeze({ low: 0.45, groundBack: 1.6, groundSide: 0.9, frameHim: 0.45, clip: 0.6, white: 0.82, whiteShare: 0.15, back: 1.2, overBack: 0.6, up: 0.35, overUp: 1.4, eye: 1.5, aim: 1.2, window: 1.5, ease: 0.03, near: 0.7, wall: 0.45, blockedAt: 3, blocked: 0.6, top: 0.5, cracks: 4, thumps: 4, fov: 70 });
const UNDER_FIRE_SRC = `window.__underFire = (() => {
  let st = null;
  return {
    install(pid, passes, cfg, aims = null) {
      const r = window.replay;
      const B = window.__rbSync;
      const kills = () => r.kills ?? r.rec.kills;
      if (aims?.length) return this.facing(pid, aims, cfg);
      st = { chain: r.camera.lensHook ?? null, threat: null, head: null, step: 0, tick: -1, walled: 0, frames: 0, near: null };
      const mix = (a, b, k) => a ? a.map((x, i) => x + (b[i] - x) * k) : b.slice();
      r.camera.setLensHook(c => {
        st?.chain?.(c);
        if (!st) return;
        const t = r.time;
        const me = B.whereIs(r.rec, pid, t, kills());
        if (!me?.pos) return;
        let now = passes.filter(p => Math.abs(p.t - t) <= cfg.window);
        if (!now.length) now = [passes.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a))];
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const p of now) {
          const w = B.whereIs(r.rec, p.shooter, t, kills());
          if (!w?.pos) continue;
          sx += w.pos[0]; sy += w.pos[1]; sz += w.pos[2]; n++;
        }
        const head = [me.pos[0], me.pos[1] + cfg.eye, me.pos[2]];
        st.head = mix(st.head, head, 0.5);
        if (n) st.threat = mix(st.threat, [sx / n, sy / n + cfg.aim, sz / n], st.threat ? cfg.ease : 1);
        if (!st.threat) return;
        const dx = st.threat[0] - st.head[0], dz = st.threat[2] - st.head[2];
        const flat = Math.hypot(dx, dz) || 1;
        const ux = dx / flat, uz = dz / flat;
        if (st.step === 0) {
          // On the ground beside him, a step back and to his side.
          const x = st.head[0] - ux * cfg.groundBack - uz * cfg.groundSide;
          const z = st.head[2] - uz * cfg.groundBack + ux * cfg.groundSide;
          const feet = st.head[1] - cfg.eye;
          const g = r.ctx.groundHeight?.(x, z, feet + 2);
          c.position.set(x, (Number.isFinite(g) && Math.abs(g - feet) < 3 ? g : feet) + cfg.low, z);
          // Between the guns and him: he stands in the picture.
          const toHim = c.position.clone().set(st.head[0], st.head[1] - 0.3, st.head[2]).sub(c.position).normalize();
          const toGuns = c.position.clone().set(st.threat[0], Math.max(st.threat[1], feet + cfg.eye), st.threat[2]).sub(c.position).normalize();
          c.lookAt(toHim.multiplyScalar(cfg.frameHim).add(toGuns.multiplyScalar(1 - cfg.frameHim)).add(c.position));
        } else {
          const over = st.step === 2;
          const back = over ? cfg.overBack : cfg.back;
          c.position.set(st.head[0] - ux * back, st.head[1] + (over ? cfg.overUp : cfg.up), st.head[2] - uz * back);
          c.lookAt(c.position.clone().set(st.threat[0], st.threat[1], st.threat[2]));
        }
        st.near ??= c.near;
        st.cam = c;
        if (c.fov !== cfg.fov || c.near !== cfg.clip) { c.fov = cfg.fov; c.near = cfg.clip; c.updateProjectionMatrix(); }
        c.updateMatrixWorld();
        st.frames++;
        st.tick++;
        const D = window.__depth;
        if (D && st.tick % 4 === 0 && D.take(c)) {
          const walled = D.near(cfg.near) > cfg.wall || D.nearTop(cfg.blockedAt, cfg.top) > cfg.blocked;
          if (walled && st.step < 2) st.step++;
          else if (walled) st.walled++;
        }
      });
    },
    /** Facing the gun from downrange (FACING_CAM): aims are its shots, in
     *  the viewer's frame. Steps: his right, his left, high. */
    facing(pid, aims, cfg) {
      const r = window.replay;
      const B = window.__rbSync;
      st = { chain: r.camera.lensHook ?? null, step: 0, tick: -1, walled: 0, frames: 0, near: null, m: null, d: null };
      const mix = (a, b, k) => a ? a.map((x, i) => x + (b[i] - x) * k) : b.slice();
      r.camera.setLensHook(c => {
        st?.chain?.(c);
        if (!st) return;
        const t = r.time;
        let a = aims[0];
        for (const x of aims) { if (x.t <= t) a = x; else break; }
        st.m = mix(st.m, a.pos, st.m ? 0.15 : 1);
        st.d = mix(st.d, a.dir, st.d ? cfg.ease : 1);
        const fx = st.d[0], fz = st.d[2];
        const flat = Math.hypot(fx, fz) || 1;
        const ux = fx / flat, uz = fz / flat;
        const hull = B.whereIs(r.rec, pid, t, r.kills ?? r.rec.kills)?.state === 'vehicle';
        const [out, side0, up] = hull ? cfg.hull : cfg.man;
        const side = st.step === 1 ? -side0 : side0;
        const lift = st.step === 2 ? cfg.high : 0;
        const x = st.m[0] + ux * out - uz * side;
        const z = st.m[2] + uz * out + ux * side;
        let y = st.m[1] + up + lift;
        const g = r.ctx.groundHeight?.(x, z, y + 2);
        if (Number.isFinite(g) && y < g + cfg.ground) y = g + cfg.ground;
        c.position.set(x, y, z);
        // At the gun, a little behind the muzzle: the man or the hull firing.
        c.lookAt(c.position.clone().set(st.m[0] - ux * cfg.look, st.m[1] - 0.2, st.m[2] - uz * cfg.look));
        st.near ??= c.near;
        st.cam = c;
        if (c.fov !== cfg.fov || c.near !== cfg.clip) { c.fov = cfg.fov; c.near = cfg.clip; c.updateProjectionMatrix(); }
        c.updateMatrixWorld();
        st.frames++;
        st.tick++;
        const D = window.__depth;
        if (D && st.tick % 4 === 0 && D.take(c)) {
          // The gun hidden: something drawn short of its muzzle (a lamppost,
          // a crate, a tank that drove behind them; Ortona's Sherman).
          const gun = c.position.clone().set(st.m[0], st.m[1], st.m[2]);
          const far = c.position.distanceTo(gun);
          const drawn = D.at(gun, c);
          const hidden = !Number.isFinite(drawn) ? false : drawn < far - 1.5;
          st.hid = hidden ? (st.hid ?? 0) + 1 : 0;
          const walled = D.near(cfg.near) > cfg.wall || D.nearTop(cfg.blockedAt, cfg.top) > cfg.blocked || st.hid >= 2;
          if (walled && st.step < 2) { st.step++; st.hid = 0; }
          else if (walled) st.walled++;
        }
      });
    },
    /** The share of probes still blocked with the camera over him, and the step it ended on. */
    walled() { return st ? st.walled / Math.max(1, Math.ceil(st.frames / 4)) : 0; },
    step() { return st?.step ?? 0; },
    remove() {
      const chain = st?.chain ?? null;
      const cam = st?.cam ?? null;
      if (st?.near != null && cam) { cam.near = st.near; cam.updateProjectionMatrix(); }
      st = null;
      window.replay.camera.setLensHook(chain);
    },
  };
})();`;

async function filmTake(page, part, write) {
  const underFire = part.what === 'under-fire';
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
  await page.evaluate(async ({ src, depth, pid, cfg, under, underSrc, passes, underCfg, aims, facingCfg }) => {
    window.__rbSync ??= await import(new URL('replay-battles.js', location.href).href);
    if (!window.__depth) (0, eval)(depth);
    await window.__depth.ready();
    if (!window.__underFire) (0, eval)(underSrc);
    if (under) window.__underFire.install(pid, passes, underCfg);
    else if (aims?.length) window.__underFire.install(pid, [], facingCfg, aims);
    else {
      // A moment from before the picker kept its aims: behind him, as before.
      if (!window.__director) (0, eval)(src);
      window.__director.install(pid, [], cfg);
    }
    window.replay.playing = true;
    window.__asmrSlow = 0;
  }, { src: DIRECTOR_SRC, depth: DEPTH_SRC, pid: part.pid, cfg: DIRECTOR, under: underFire, underSrc: UNDER_FIRE_SRC,
    passes: part.passes ?? [], underCfg: UNDER_FIRE_CAM, aims: part.aims ?? null, facingCfg: FACING_CAM });
  const facing = !underFire && Boolean(part.aims?.length);
  // The rounds the page flew for their crack (`passing-rounds.js`), and every
  // sample started, by its buffer: the cracks heard are the starts of a
  // passing-round script's samples.
  const flownBefore = await page.evaluate(() => {
    if (!window.__startsByBuffer) {
      const starts = window.__startsByBuffer = new Map();
      const real = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...a) {
        if (this.buffer) starts.set(this.buffer, (starts.get(this.buffer) ?? 0) + 1);
        return real.apply(this, a);
      };
    }
    window.__startsByBuffer.clear();
    // Each effect script's plays, for the impacts heard (thumps) after.
    window.__playsBefore = new Map((window.__effectAudio?.()?.scripts ?? []).map(x => [x.script, x.plays]));
    return window.__passingRounds?.() ?? null;
  });
  const named = await page.evaluate(w => window.replay.creator.display?.(w) || w, part.weapon);
  // Under fire: the words, and the gun that fired most of the rounds under them.
  const others = (part.weapons?.length ?? 1) - 1;
  const caption = underFire ? 'Under fire' : named;
  const sub = underFire ? `${named}${others > 0 ? ` and ${others} more` : ''}` : '';
  const shots = part.shots?.length ? part.shots : [part.t];
  const last = shots.at(-1);
  // Real time throughout (the owner, 2026-11-07: "we don't want slo mo").
  const slowFrom = Infinity;
  let from = null;
  const held = [];
  const paces = [];
  const lums = [];
  for (let k = 0; k < MAX_FRAMES; k++) {
    const res = await page.evaluate(async ({ W, H, FPS, t1, caption, sub, top, k, fade, slowFrom, pace, under }) => {
      const r = window.replay;
      const at = window.__audioT?.() ?? null;
      // 1x, then down into slow motion for the last shot.
      const u = Math.max(0, Math.min(1, (r.time - (slowFrom - pace.ease)) / pace.ease));
      r.speed = 1 + (pace.slow - 1) * u * u * (3 - 2 * u);
      if (u >= 1) window.__asmrSlow = (window.__asmrSlow ?? 0) + 1;
      const speed = r.speed;
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      // The sound runs at the round's pace, not the video's: slowed after,
      // like tape (`__audioWavs`).
      await window.__audioStep?.(speed / FPS);
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
      if (sub) {
        g.font = '600 30px system-ui, "Segoe UI", sans-serif';
        g.fillText(String(sub), W / 2, 162 + top);
      }
      g.shadowBlur = 0;
      if (k < fade) {
        g.fillStyle = `rgba(0,0,0,${1 - (k + 1) / (fade + 1)})`;
        g.fillRect(0, 0, W, H);
      }
      const end = r.time >= t1 || (window.__asmrSlow ?? 0) >= pace.hold * FPS;
      // Under fire: the frame's mean brightness, for the white-out check.
      let lum = null;
      if (under) {
        const sm = (window.__lumCv ??= Object.assign(document.createElement('canvas'), { width: 18, height: 32 }));
        const sg = sm.getContext('2d', { willReadFrequently: true });
        sg.drawImage(window.__renderer.domElement, 0, 0, 18, 32);
        const px = sg.getImageData(0, 0, 18, 32).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        lum = sum / (px.length / 4) / 255;
      }
      return { at, end, speed, lum, url: cv.toDataURL('image/jpeg', 0.92) };
    }, { W, H, FPS, t1: part.t1, caption, sub, top: OVERLAY_TOP, k, fade: DIP.in, slowFrom, pace: ASMR_PACE, under: underFire || facing });
    if (from === null) from = res.at;
    held.push(res.url);
    paces.push(res.speed);
    if (res.lum !== null) lums.push(res.lum);
    if (res.end) break;
  }
  // Under fire, a moment whose camera stayed in a wall even moved in to his
  // head is no moment.
  if (underFire) {
    const flown = await page.evaluate(() => {
      const p = window.__passingRounds?.(true);
      if (!p) return null;
      let cracks = 0;
      for (const b of p.buffers ?? []) cracks += window.__startsByBuffer?.get(b) ?? 0;
      // A round striking something near the lens: a ricochet or a hit's script
      // played (an explosion is not a thump).
      const played = (window.__effectAudio?.()?.scripts ?? []).map(x => [x.script, x.plays - (window.__playsBefore?.get(x.script) ?? 0)]).filter(([, n]) => n > 0);
      const hit = /richo|impact|bullet.?hit|hit_|dirt|sand|mud|snow|grass|wood|metal|stone|water/i;
      const thumps = played.filter(([k]) => hit.test(k) && !/explo|#flight|engine|projectile/i.test(k)).reduce((a, [, n]) => a + n, 0);
      return { flown: p.flown, skipped: p.skipped, cracks, thumps, step: window.__underFire?.step() ?? 0,
        played: played.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k.split('/').pop()} ${n}`).join(', ') };
    });
    if (flown && flownBefore) {
      log(`    under fire at ${part.t.toFixed(1)}: ${flown.flown - flownBefore.flown} rounds flown past his ear, ${flown.skipped - flownBefore.skipped} never near it, ${flown.cracks} cracks and ${flown.thumps} impacts heard, camera ${['on the ground', 'at his shoulder', 'over him'][flown.step]}`);
      log(`      effect sounds played: ${flown.played || 'none'}`);
    } else {
      log(`    under fire at ${part.t.toFixed(1)}: this viewer flies no replayed round's crack (no guns.onBullet live yet)`);
    }
    if ((flown?.cracks ?? 0) < UNDER_FIRE_CAM.cracks && (flown?.thumps ?? 0) < UNDER_FIRE_CAM.thumps) {
      await page.evaluate(() => { window.__underFire?.remove(); window.replay.speed = 1; });
      log(`    under fire at ${part.t.toFixed(1)}: only ${flown?.cracks ?? 0} cracks and ${flown?.thumps ?? 0} impacts heard, left out`);
      return { audio: null, left: true };
    }
    const walled = await page.evaluate(() => {
      const w = window.__underFire?.walled() ?? 0;
      window.__underFire?.remove();
      window.replay.speed = 1;
      return w;
    });
    if (walled > 0.4) {
      log(`    under fire at ${part.t.toFixed(1)}: the camera is in a wall ${Math.round(walled * 100)}% of it, left out`);
      return { audio: null, left: true };
    }
    const white = lums.filter(l => l > UNDER_FIRE_CAM.white).length / Math.max(1, lums.length);
    if (white > UNDER_FIRE_CAM.whiteShare) {
      log(`    under fire at ${part.t.toFixed(1)}: white ${Math.round(white * 100)}% of it, left out`);
      return { audio: null, left: true };
    }
    const out = await dipOut(page, held);
    for (const url of out.frames) write(url);
    const to = await page.evaluate(() => window.__audioT?.() ?? null);
    if (from === null || to === null) return { audio: null };
    return { audio: [from, to, slowedSound(paces, out.kept, to - from)] };
  }
  // Facing the gun: left out when the lens stayed blocked or ran white.
  if (facing) {
    const got = await page.evaluate(() => {
      const p = window.__passingRounds?.(true);
      let cracks = 0;
      for (const b of p?.buffers ?? []) cracks += window.__startsByBuffer?.get(b) ?? 0;
      const res = { walled: window.__underFire?.walled() ?? 0, step: window.__underFire?.step() ?? 0, cracks };
      window.__underFire?.remove();
      window.replay.speed = 1;
      return res;
    });
    const lit = lums.slice(DIP.in);
    const white = lit.filter(l => l > FACING_CAM.white).length / Math.max(1, lit.length);
    const black = lit.filter(l => l < FACING_CAM.black).length / Math.max(1, lit.length);
    log(`    asmr ${part.weapon} at ${part.t.toFixed(1)}: facing the gun from ${['his right', 'his left', 'high'][got.step]}, ${got.cracks} of its rounds cracked past the lens`);
    // A gun piece is clean: Ortona's Sherman, a flag at the lens and a blast,
    // ran 18% white or black; the good ones 1% at most.
    if (got.walled > 0.4 || white + black > FACING_CAM.spoilt) {
      log(`    asmr ${part.weapon} at ${part.t.toFixed(1)}: ${got.walled > 0.4 ? `blocked ${Math.round(got.walled * 100)}%` : `white or black ${Math.round((white + black) * 100)}%`} of it, left out`);
      return { audio: null, left: true };
    }
    const out = await dipOut(page, held);
    for (const url of out.frames) write(url);
    const to = await page.evaluate(() => window.__audioT?.() ?? null);
    if (from === null || to === null) return { audio: null };
    return { audio: [from, to, slowedSound(paces, out.kept, to - from)] };
  }
  // An ASMR moment is its gun firing: one seen mostly through his eyes (an
  // MG dug in, walls all round) is no moment.
  const shares = await page.evaluate(() => window.__director?.shares() ?? [1, 0, 0, 0, 0]);
  if (args.includes('--debug-director')) {
    const probes = await page.evaluate(() => window.__director?.log() ?? []);
    const chase = probes.filter(x => x[0] === 0).map(x => x[1]);
    log(`    director ${part.weapon}: poses ${shares.map(x => x.toFixed(2)).join('/')}, chase near ${chase.slice(0, 8).join(' ')} (reach ${probes[0]?.[2]})`);
  }
  if (shares[4] > 0.4) {
    await page.evaluate(() => { window.__director?.remove(); window.replay.speed = 1; });
    log(`    asmr ${part.weapon} at ${part.t.toFixed(1)}: its gun cannot be seen, left out`);
    return { audio: null, left: true };
  }
  const out = await dipOut(page, held);
  for (const url of out.frames) write(url);
  const to = await page.evaluate(() => { window.__director?.remove(); window.replay.speed = 1; return window.__audioT?.() ?? null; });
  if (from === null || to === null) return { audio: null };
  return { audio: [from, to, slowedSound(paces, out.kept, to - from)] };
}

/**
 * The arsenal (picker `arsenalOf`, the owner, 2026-11-07): one gun alone in
 * its level (a range recording, shorts-range.mjs), each in two beats, real
 * time, the game's own sound. `report`: up close, three-quarters from in
 * front ([out, side, up] metres from the hull along its aim), its report at
 * the lens. `whizz`: from `out` metres downrange, `side` off its line of
 * fire, through a long lens that holds `size` metres of height at the gun,
 * so it fills the frame firing at the lens and its rounds crack past (a
 * crack opens about 55 m out). The level behind is blurred (`blur` px) and
 * the gun, its flash and its tracers drawn sharp over it (a second render of
 * them alone on `key`, keyed out). When the gun is hidden from the downrange
 * camera it crosses the line of fire, then comes in to `nearer` of the way.
 * The downrange camera stands along its line of fire as it is (up the sky
 * for an AA gun: the Flak 38's rounds passed far over a camera at its
 * height, 2 cracks) and inside how far its rounds flew in the report beat
 * (`short` short of it); rounds that flew under `min` metres never crack
 * (an MG42 at men 30 m off: 0 cracks), and the gun keeps its report alone;
 * still hidden, the beat is left out. A hull longer than `big` metres (a
 * ship) is left out for now: framed on its gun's mount the lens found a
 * deck rail. A bullet gun's whizz with fewer than `whizz.cracks` cracks is
 * left out (a big gun's shell whistles, it does not crack). Its name on top (the
 * template tidied where the game has no name for it), the weapon under it,
 * and in the report beat a ring on the firing barrel when it has more than
 * one gun.
 */
const ARSENAL_CAM = Object.freeze({
  report: [8, 5.5, 1.8], fov: 48, whizz: { out: 70, side: 2.5, up: 0.4, size: 7, nearer: 0.75, min: 62, short: 6, cracks: 3 }, blur: 10,
  ground: 0.5, hidden: 3, big: 14,
});
const ARSENAL_SRC = `window.__arsenal = (() => {
  let st = null;
  const bare = n => String(n || '').replace(/_\\d+$/, '').replace(/ \\d+$/, '');
  return {
    install(nid, weapon, aims, cfg, beat, flight = null) {
      const r = window.replay;
      const T = window.__THREE;
      const hull = [...r.hulls.values()].find(h => h.life?.nid === nid) ?? null;
      if (!hull) return { ok: false };
      const guns = hull.groups.filter(g => !/spotter/i.test(g.node?.name ?? ''));
      const group = guns.find(g => bare(g.node?.name) === weapon) ?? guns.find(g => (g.node?.name ?? '').includes(weapon)) ?? null;
      // A ship is a hundred metres of hull: frame its gun's mount, not its middle.
      const size = new T.Box3().setFromObject(hull.root).getSize(new T.Vector3());
      const big = Math.max(size.x, size.z) > cfg.big;
      // A ship is left out: framed on its mount, the lens found a deck rail
      // and grey sky (Omaha's Fletcher); it wants framing of its own.
      if (big) return { ok: false, big: true };
      // The whizz needs its rounds to fly past the lens: a crack opens about
      // 55 m out, so rounds that land short of that never crack anywhere.
      if (beat === 'whizz' && flight !== null && flight < cfg.whizz.min) return { ok: false, short: true };
      const out = beat === 'whizz' && flight !== null ? Math.min(cfg.whizz.out, flight - cfg.whizz.short) : cfg.whizz.out;
      st = { flight: 0, out, hull, group, many: guns.length > 1, aims, cfg, beat, step: 0, m: null, d: null, hid: 0, walled: 0, frames: 0, tick: -1, big,
        chain: r.camera.lensHook ?? null, near: null, cam: null, centre: new T.Vector3(), muzzle: new T.Vector3(), look: new T.Vector3() };
      const mix = (a, b, k) => a ? a.map((x, i) => x + (b[i] - x) * k) : b.slice();
      r.camera.setLensHook(c => {
        st?.chain?.(c);
        if (!st) return;
        const t = r.time;
        let a = aims[0];
        for (const x of aims) { if (x.t <= t) a = x; else break; }
        st.d = mix(st.d, a.dir, st.d ? 0.08 : 1);
        hull.root.updateWorldMatrix(true, false);
        if (st.big && st.group?.node) { st.group.node.updateWorldMatrix(true, false); st.group.node.getWorldPosition(st.centre); }
        else { hull.root.getWorldPosition(st.centre); st.centre.y += 1.0; }
        const mz = st.group?.muzzles?.[0];
        if (mz) { mz.updateWorldMatrix(true, false); mz.getWorldPosition(st.muzzle); } else st.muzzle.set(a.pos[0], a.pos[1], a.pos[2]);
        // How far its rounds fly (to a hit, or their time to live).
        for (const tr of r.ctx.guns?.tracers ?? []) if (tr.group === st.group) st.flight = Math.max(st.flight, tr.travelled ?? 0);
        for (const sh of r.ctx.guns?.projectiles ?? []) if (sh.group === st.group) st.flight = Math.max(st.flight, sh.travelled ?? 0);
        const flat = Math.hypot(st.d[0], st.d[2]) || 1;
        const ux = st.d[0] / flat, uz = st.d[2] / flat;
        let x, y, z;
        if (beat === 'report') {
          const [out, side, up] = cfg.report;
          x = st.centre.x + ux * out - uz * side;
          z = st.centre.z + uz * out + ux * side;
          y = st.centre.y + up;
          st.look.lerpVectors(st.centre, st.muzzle, 0.4);
          c.fov = cfg.fov;
        } else {
          // Along its line of fire as it is, up for an AA gun.
          const w = cfg.whizz;
          const out = st.out * (st.step === 2 ? w.nearer : 1);
          const side = st.step === 1 ? -w.side : w.side;
          const len = Math.hypot(st.d[0], st.d[1], st.d[2]) || 1;
          x = st.muzzle.x + st.d[0] / len * out - uz * side;
          z = st.muzzle.z + st.d[2] / len * out + ux * side;
          y = st.muzzle.y + st.d[1] / len * out + w.up;
          st.look.copy(st.centre);
          c.fov = 2 * Math.atan(w.size / 2 / out) * 180 / Math.PI;
        }
        const g = r.ctx.groundHeight?.(x, z, y + 3);
        if (Number.isFinite(g) && y < g + cfg.ground) y = g + cfg.ground;
        c.position.set(x, y, z);
        c.lookAt(st.look);
        st.near ??= c.near;
        st.cam = c;
        c.near = beat === 'report' ? 0.5 : 5;
        c.updateProjectionMatrix();
        c.updateMatrixWorld();
        st.frames++;
        st.tick++;
        const D = window.__depth;
        if (beat === 'whizz' && D && st.tick % 4 === 0 && D.take(c)) {
          const far = c.position.distanceTo(st.centre);
          const drawn = D.at(st.centre, c);
          const hidden = Number.isFinite(drawn) && drawn < far - cfg.hidden;
          st.hid = hidden ? st.hid + 1 : 0;
          if (st.hid >= 2 && st.step < 2) { st.step++; st.hid = 0; } else if (st.hid >= 2) st.walled++;
        }
      });
      return { ok: true, many: st.many, group: Boolean(st.group), big };
    },
    /** The frame: the level blurred, the gun sharp over it, its words. */
    compose(g, W, H, cfg, text) {
      const r = window.replay;
      const T = window.__THREE;
      const R = window.__renderer, S = window.__scene, C = window.__camera;
      g.filter = 'blur(' + cfg.blur + 'px)';
      g.drawImage(R.domElement, 0, 0, W, H);
      g.filter = 'none';
      if (st?.hull) {
        const top = o => { while (o.parent && o.parent !== S) o = o.parent; return o; };
        const keep = new Set([top(st.hull.root)]);
        for (const ch of S.children) if (ch.name === 'effects' || ch.isLight || ch.type === 'HemisphereLight') keep.add(ch);
        for (const tr of r.ctx.guns?.tracers ?? []) keep.add(top(tr.mesh));
        const vis = S.children.map(ch => ch.visible);
        const bg = S.background, fog = S.fog;
        S.children.forEach(ch => { ch.visible = keep.has(ch) || ch.isLight === true; });
        S.background = new T.Color(1, 0, 1);
        S.fog = null;
        R.render(S, C);
        S.children.forEach((ch, i) => { ch.visible = vis[i]; });
        S.background = bg;
        S.fog = fog;
        const kc = (window.__keyCv ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
        const kg = kc.getContext('2d', { willReadFrequently: true });
        kg.clearRect(0, 0, W, H);
        kg.drawImage(R.domElement, 0, 0, W, H);
        const im = kg.getImageData(0, 0, W, H);
        const d = im.data;
        for (let i = 0; i < d.length; i += 4) {
          const m = Math.min(d[i], d[i + 2]) - d[i + 1];
          if (m > 150) d[i + 3] = 0;
          else if (m > 70) { const a = (150 - m) / 80; d[i + 3] = 255 * a; d[i] = d[i + 1]; d[i + 2] = d[i + 1]; }
        }
        kg.putImageData(im, 0, 0);
        g.drawImage(kc, 0, 0);
      }
      // Its words: the vehicle, the weapon, and the firing barrel ringed.
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = 'rgba(0,0,0,0.75)';
      g.shadowBlur = 14;
      g.fillStyle = 'rgba(246,241,226,0.95)';
      g.font = '800 54px system-ui, "Segoe UI", sans-serif';
      g.fillText(String(text.title).toUpperCase(), W / 2, 120 + text.top);
      g.font = '600 34px system-ui, "Segoe UI", sans-serif';
      g.fillStyle = 'rgba(232,196,112,0.95)';
      g.fillText(String(text.weapon), W / 2, 178 + text.top);
      g.shadowBlur = 0;
      if (st?.beat === 'report' && st.many && st.group) {
        const v = st.muzzle.clone().project(C);
        if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) {
          const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
          g.strokeStyle = 'rgba(232,196,112,0.95)';
          g.lineWidth = 4;
          g.beginPath(); g.arc(sx, sy, 30, 0, Math.PI * 2); g.stroke();
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(sx, sy - 30); g.lineTo(sx, 210 + text.top); g.stroke();
        }
      }
    },
    walled() { return st ? st.walled / Math.max(1, Math.ceil(st.frames / 4)) : 0; },
    flight() { return st?.flight ?? 0; },
    remove() {
      const chain = st?.chain ?? null;
      if (st?.cam && st.near != null) { st.cam.near = st.near; st.cam.updateProjectionMatrix(); }
      st = null;
      window.replay.camera.setLensHook(chain);
    },
  };
})();`;

/** How far each arsenal gun's rounds flew in its report beat, for its whizz. */
const FLIGHTS = new Map();

/** One beat of an arsenal gun (ARSENAL_CAM): real time from `t0` to `t1`,
 *  in from black and out through the dip. Returns its stretch of the sound. */
async function filmArsenalTake(page, part, write) {
  await page.evaluate(({ from }) => {
    const r = window.replay;
    r.creator.toggle(false);
    r.seek(Math.max(0, from));
    r.speed = 1;
    r.playing = false;
    if (r.ui?.setMode) r.ui.setMode('free');
  }, { from: part.t0 });
  await page.waitForTimeout(800);
  const flightKey = `${part.slug}|${part.nid}|${part.weapon}|${part.t}`;
  const set = await page.evaluate(async ({ src, depth, nid, weapon, aims, cfg, beat, flight }) => {
    window.__rbSync ??= await import(new URL('replay-battles.js', location.href).href);
    if (!window.__depth) (0, eval)(depth);
    await window.__depth.ready();
    if (!window.__arsenal) (0, eval)(src);
    return window.__arsenal.install(nid, weapon, aims, cfg, beat, flight);
  }, { src: ARSENAL_SRC, depth: DEPTH_SRC, nid: part.nid, weapon: part.weapon, aims: part.aims, cfg: ARSENAL_CAM, beat: part.beat,
    flight: part.beat === 'whizz' ? FLIGHTS.get(flightKey) ?? null : null });
  if (set.short) {
    log(`    arsenal ${part.weapon} at ${part.t.toFixed(1)}: its rounds flew ${Math.round(FLIGHTS.get(flightKey))} m, too short to crack; its whizz left out`);
    return { audio: null, left: true };
  }
  if (set.big) {
    log(`    arsenal ${part.weapon} at ${part.t.toFixed(1)}: on a ship, left out`);
    return { audio: null, left: true };
  }
  if (!set.ok) {
    log(`    arsenal ${part.weapon} at ${part.t.toFixed(1)}: its hull is not in the range, left out`);
    return { audio: null, left: true };
  }
  for (let k = 0; k < 12; k++) {
    await page.evaluate(async ({ W, H, FPS }) => {
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
    }, { W, H, FPS });
  }
  const text = await page.evaluate(({ platform, weapon }) => {
    const shown = n => {
      const d = window.replay.creator.display?.(n);
      return d && d !== n ? d : String(n ?? '').replace(/_/g, ' ').replace(/(\D)\d$/, '$1').trim();
    };
    return { title: shown(platform || weapon), weapon: shown(weapon) };
  }, { platform: part.platform, weapon: part.weapon });
  // The cracks heard: every sample started, by its buffer (the whizz beat's
  // are its rounds' passing cracks).
  await page.evaluate(() => {
    if (!window.__startsByBuffer) {
      const starts = window.__startsByBuffer = new Map();
      const real = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...a) {
        if (this.buffer) starts.set(this.buffer, (starts.get(this.buffer) ?? 0) + 1);
        return real.apply(this, a);
      };
    }
    window.__startsByBuffer.clear();
  });
  await page.evaluate(() => { window.replay.playing = true; });
  let from = null;
  const held = [];
  for (let k = 0; k < MAX_FRAMES; k++) {
    const res = await page.evaluate(async ({ W, H, FPS, t1, k, fade, cfg, text }) => {
      const r = window.replay;
      const at = window.__audioT?.() ?? null;
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
      const cv = (window.__reelCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
      const g = cv.getContext('2d');
      window.__arsenal.compose(g, W, H, cfg, text);
      if (k < fade) {
        g.fillStyle = 'rgba(0,0,0,' + (1 - (k + 1) / (fade + 1)) + ')';
        g.fillRect(0, 0, W, H);
      }
      return { at, end: r.time >= t1, url: cv.toDataURL('image/jpeg', 0.92) };
    }, { W, H, FPS, t1: part.t1, k, fade: DIP.in, cfg: ARSENAL_CAM, text: { ...text, top: OVERLAY_TOP } });
    if (from === null) from = res.at;
    held.push(res.url);
    if (res.end) break;
  }
  const { walled, flight } = await page.evaluate(() => {
    const res = { walled: window.__arsenal?.walled() ?? 0, flight: window.__arsenal?.flight() ?? 0 };
    window.__arsenal?.remove();
    return res;
  });
  if (part.beat === 'report') FLIGHTS.set(flightKey, flight);
  if (part.beat === 'whizz' && walled > 0.4) {
    log(`    arsenal ${part.weapon} at ${part.t.toFixed(1)}: hidden from downrange ${Math.round(walled * 100)}% of it, its whizz left out`);
    return { audio: null, left: true };
  }
  const cracks = await page.evaluate(() => {
    const p = window.__passingRounds?.(true);
    let n = 0;
    for (const b of p?.buffers ?? []) n += window.__startsByBuffer?.get(b) ?? 0;
    return n;
  });
  log(`    arsenal ${part.weapon} at ${part.t.toFixed(1)}: ${part.beat}, ${held.length} frames${part.beat === 'whizz' ? `, ${cracks} cracks heard` : ''}${set.big ? ', framed on its mount' : ''}`);
  // A whizz is its rounds cracking past: one that heard none is no whizz
  // (a Hanomag's MG42 on Omaha flew far and cracked not once).
  // A big gun's shell whistles past rather than cracks: only bullets are held to it.
  if (part.beat === 'whizz' && part.what !== 'cannon' && cracks < ARSENAL_CAM.whizz.cracks) {
    log(`    arsenal ${part.weapon} at ${part.t.toFixed(1)}: only ${cracks} cracks, its whizz left out`);
    return { audio: null, left: true };
  }
  const out = await dipOut(page, held);
  for (const url of out.frames) write(url);
  const to = await page.evaluate(() => window.__audioT?.() ?? null);
  if (from === null || to === null) return { audio: null };
  return { audio: [from, to] };
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
  await page.evaluate(async ({ src, depth, pid, victims, cfg }) => {
    window.__rbSync ??= await import(new URL('replay-battles.js', location.href).href);
    if (!window.__director) (0, eval)(src);
    if (!window.__depth) (0, eval)(depth);
    await window.__depth.ready();
    window.__director.install(pid, victims, cfg);
    window.replay.playing = true;
    window.__burstLast = -1;
    window.__burstSeen = [];
  }, { src: DIRECTOR_SRC, depth: DEPTH_SRC, pid: reel.player, victims: reel.parts.map(p => ({ pid: p.victim, t: p.t })), cfg: DIRECTOR });
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
        // Where he was a moment before he died: at the death itself he has none.
        window.__burstSeen.push(window.__clean?.(victims[count - 1], kills[count - 1] - 0.1) ?? true);
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
  const shares = await page.evaluate(() => window.__director?.shares() ?? [1, 0, 0, 0, 0]);
  const to = await page.evaluate(() => { window.__director?.remove(); window.replay.speed = 1; return window.__audioT?.() ?? null; });
  const flags = await page.evaluate(() => window.__burstSeen ?? []);
  const whys = await page.evaluate(() => (window.__cleanWhy ?? []).splice(0));
  if (whys.length) log(`    unseen: ${whys.join('; ')}`);
  const seen = flags.length ? flags.filter(Boolean).length / flags.length : 0;
  log(`    burst taken at ${base.toFixed(2)}x between kills, ${frames} frames, ${Math.round(seen * 100)}% of its kills seen`);
  return { frames: done, seen, roomy: shares[0], audio: from !== null && to !== null ? [from, to] : null };
}

/**
 * One stretch of a streak in one take (STRETCH_PACE): the game's chase camera
 * behind him with the director's rules, the clock fast between kills and slow
 * on each, the count ticking on each hit and a kill feed row for it, each man
 * he kills tagged red as he dies. The ending's stretch runs into his death:
 * the man who kills him tagged as he comes, the camera standing back to show
 * both, grey, held. `before` is the count before its first kill. Returns `{
 * frames, audio, hits: [{ frame, index, seen }], seen }`.
 */
async function filmStretch(page, reel, s, { first = false, before = 0, rollFrom = null } = {}) {
  const death = s.ending ? reel.endedAt : null;
  const slowAt = [...s.kills.map(k => k.t), ...(death !== null ? [death] : [])];
  const end = death ?? s.t1;
  const rest = Math.max(0, end - s.t0 - slowAt.length * (STRETCH_PACE.before + STRETCH_PACE.after));
  const base = Math.min(STRETCH_PACE.maxSpeed, Math.max(1, rest / Math.max(STRETCH_PACE.minRest, slowAt.length * STRETCH_PACE.perKill)));
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
  }, { from: s.t0, pid: reel.player });
  await page.waitForTimeout(1200);
  for (let k = 0; k < 20; k++) {
    await page.evaluate(async ({ W, H, FPS }) => {
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
    }, { W, H, FPS });
  }
  await page.evaluate(async ({ src, depth, cfg, st, aim }) => {
    const r = window.replay;
    window.__rbSync ??= await import(new URL('replay-battles.js', location.href).href);
    if (!window.__director) (0, eval)(src);
    if (!window.__depth) (0, eval)(depth);
    await window.__depth.ready();
    const VP = (window.__vp ??= await import(new URL('vehicle-players.js', location.href).href));
    const shown = n => (n && VP.decodePlayerName ? VP.decodePlayerName(n) : n ?? '');
    const d = w => (w ? r.creator.display(w) || w : '');
    window.__director.install(st.pid, st.kills.map(k => ({ pid: k.victim, t: k.t })), cfg);
    // Over his shoulder toward the man he is killing, around each kill (AIM),
    // after the director has placed the camera. The director's remove (at his
    // death, at the take's end) takes this hook away with its own.
    const B = window.__rbSync;
    const D = window.__depth;
    const dirHook = r.camera.lensHook;
    const cam = r.ctx.camera;
    const V = (x = 0, y = 0, z = 0) => cam.position.clone().set(x, y, z);
    const A = { w: 0, pos: null, look: null, tick: -1, pick: null };
    const posAt = (pid, t) => B.whereIs(r.rec, pid, t, r.kills ?? r.rec.kills)?.pos ?? null;
    const lookQ = (at, look) => new (cam.quaternion.constructor)().setFromRotationMatrix(new (cam.matrixWorld.constructor)().lookAt(at, look, V(0, 1, 0)));
    // Is he seen from `p` looking at `look`, with no wall filling the lens?
    const clearFrom = (c, p, look, eye, slack = 0.8) => {
      const saved = [c.position.clone(), c.quaternion.clone()];
      c.position.copy(p);
      c.quaternion.copy(lookQ(p, look));
      c.updateMatrixWorld();
      D.take(c);
      const ok = D.at(eye, c) >= p.distanceTo(eye) - slack && D.near(aim.wallNear) < aim.wall;
      c.position.copy(saved[0]);
      c.quaternion.copy(saved[1]);
      c.updateMatrixWorld();
      return ok;
    };
    r.camera.setLensHook(c => {
      dirHook?.(c);
      const S = window.__stretchSt;
      if (!S || S.dead !== null) return;
      const t = r.time;
      const k = S.kills.find(x => t >= x.t - aim.before && t <= x.t + aim.after);
      const tgt = k ? { pid: k.victim, t: k.t } : S.death !== null && t >= S.death - aim.before ? { pid: S.killer, t: S.death } : null;
      const drawn = r.camera.targetAt?.(t)?.point;
      const me = posAt(S.pid, t);
      const vp = tgt ? posAt(tgt.pid, Math.min(t, tgt.t - 0.1)) : null;
      let goal = null;
      const hull = B.whereIs(r.rec, S.pid, t, r.kills ?? r.rec.kills)?.state === 'vehicle';
      if (tgt && vp && (drawn || me)) {
        const eye = drawn ? V(drawn.x, drawn.y + (hull ? 0.8 : 0.5), drawn.z) : V(me[0], me[1] + (hull ? 2 : 1.5), me[2]);
        const T = V(vp[0], vp[1] + 1.1, vp[2]);
        const flat = eye.clone().sub(T);
        flat.y = 0;
        if (flat.lengthSq() > 1e-4) {
          flat.normalize();
          const right = V(-flat.z, 0, flat.x);
          const up = hull ? aim.hullUp : aim.up;
          const pose = (side, back) => eye.clone().addScaledVector(flat, back).add(V(0, up, 0)).addScaledVector(right, side);
          A.tick++;
          if (A.tick % aim.probeEvery === 0 || A.pick === null) {
            const tries = hull
              ? [[0, aim.hullBack], [aim.hullSide, aim.hullBack], [-aim.hullSide, aim.hullBack], [0, aim.hullBack * aim.closer]]
              : [[aim.side, aim.back], [-aim.side, aim.back], [aim.side, aim.back * aim.closer], [-aim.side, aim.back * aim.closer]];
            A.pick = tries.find(([s, b]) => clearFrom(c, pose(s, b), T, eye, hull ? aim.hullSlack : 0.8)) ?? false;
          }
          if (A.pick) goal = { pos: pose(A.pick[0], A.pick[1]), look: T };
        }
      }
      A.w += ((goal ? 1 : 0) - A.w) * (1 - Math.exp(-1 / (aim.ease * 30)));
      if (goal) {
        if (!A.pos) { A.pos = c.position.clone(); A.look = c.position.clone().add(V(0, 0, -10).applyQuaternion(c.quaternion)); }
        const e = 1 - Math.exp(-1 / (aim.ease * 30));
        A.pos.lerp(goal.pos, e);
        A.look.lerp(goal.look, e);
      }
      if (A.w < 0.01 || !A.pos) { if (!goal) { A.pos = null; A.pick = null; } return; }
      c.position.lerp(A.pos, A.w);
      // Turning from the chase to the shoulder, never through the ground.
      const floor = r.ctx.groundHeight?.(c.position.x, c.position.z);
      if (Number.isFinite(floor) && c.position.y < floor + 0.6) c.position.y = floor + 0.6;
      c.quaternion.slerp(lookQ(A.pos, A.look), A.w);
      c.updateMatrixWorld();
      c.matrixWorldInverse.copy(c.matrixWorld).invert();
      S.aimed = (S.aimed ?? 0) + 1;
    });
    window.__stretchSt = {
      ...st, name: shown(st.name), killerShown: shown(st.killerName), endWeapon: d(st.endWeapon),
      kills: st.kills.map(k => ({ ...k, victimShown: shown(k.victimName), weaponShown: d(k.weapon) })),
      count: st.before, hitAt: -1, feed: [], hits: [], last: new Map(), dead: null, deadPose: null,
    };
    window.__cleanWhy = [];
    r.playing = true;
  }, { src: DIRECTOR_SRC, depth: DEPTH_SRC, cfg: DIRECTOR, aim: AIM, st: {
    pid: reel.player, name: reel.playerName, side: reel.side ?? null, kills: s.kills, before, base, slowAt, death,
    t1: s.t1, killer: reel.endedBy ?? null, killerName: reel.endedByName ?? null, endWeapon: reel.endWeapon ?? null,
    nemesis: reel.nemesis ?? 0, total: reel.total,
    title: first ? [`${reel.total} kill streak`, `on ${P.levelWords(reel.level)}`] : null, rollFrom,
  } });
  let from = null;
  const frames = [];
  for (let k = 0; k < MAX_FRAMES; k++) {
    const res = await page.evaluate(async ({ W, H, FPS, k, pace, top, dip, aim }) => {
      const r = window.replay;
      const S = window.__stretchSt;
      const B = window.__rbSync;
      const D = window.__streakDraw;
      const cam = r.ctx.camera;
      const at = window.__audioT?.() ?? null;
      // Where a man is, or where he was last: a dead man has no place.
      const place = pid => {
        const w = B.whereIs(r.rec, pid, r.time, r.kills ?? r.rec.kills);
        if (w?.pos) S.last.set(pid, [w.pos[0], w.pos[1], w.pos[2]]);
        return S.last.get(pid) ?? null;
      };
      // The clock: fast between kills, slow on each.
      if (S.dead === null) {
        let near = 0;
        for (const tk of S.slowAt) {
          const edge = Math.min(r.time - (tk - pace.before), (tk + pace.after) - r.time);
          const u = Math.max(0, Math.min(1, (edge + pace.ease) / pace.ease));
          near = Math.max(near, u * u * (3 - 2 * u));
        }
        r.speed = S.base + (pace.slow - S.base) * near;
      }
      // His death: the camera stands where it was and draws back to show him
      // and the man who killed him.
      if (S.death !== null && S.dead === null && r.time >= S.death) {
        S.dead = k;
        window.__director?.remove();
        r.speed = pace.endSlow;
        const body = S.last.get(S.pid) ?? place(S.pid);
        const kw = place(S.killer);
        const from = cam.position.clone();
        const ahead = from.clone().set(0, 0, -10).applyQuaternion(cam.quaternion).add(from);
        if (r.ui?.setMode) r.ui.setMode('free');
        else r.camera.setMode('free');
        if (body && kw) {
          // Side on to the line between the two men, far enough that both fit
          // the frame's width, on whichever side sees both past the walls;
          // else from where the camera stood, turned to both.
          const b = from.clone().set(body[0], body[1] + 0.6, body[2]);
          const kp = from.clone().set(kw[0], kw[1] + 1.2, kw[2]);
          const mid = b.clone().lerp(kp, 0.5);
          const axis = kp.clone().sub(b);
          axis.y = 0;
          if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0);
          const sep = axis.length();
          axis.normalize();
          const half = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect);
          const dist = Math.max(aim.twoShot, (sep / 2 + 1.2) / Math.tan(half * 0.85));
          const perp = from.clone().set(-axis.z, 0, axis.x);
          const back = from.clone().sub(mid);
          back.y = 0;
          if (back.lengthSq() < 1e-4) back.copy(perp);
          back.normalize();
          // The side the camera already stood on first, so it moves least.
          const sides = perp.dot(back) >= 0 ? [perp, perp.clone().negate(), back] : [perp.clone().negate(), perp, back];
          const D = window.__depth;
          const sees = p => {
            const saved = [cam.position.clone(), cam.quaternion.clone()];
            cam.position.copy(p);
            cam.lookAt(mid);
            cam.updateMatrixWorld();
            D.take(cam);
            const ok = D.at(b, cam) >= p.distanceTo(b) - 1 && D.at(kp, cam) >= p.distanceTo(kp) - 1 && D.near(2) < 0.25;
            cam.position.copy(saved[0]);
            cam.quaternion.copy(saved[1]);
            cam.updateMatrixWorld();
            return ok;
          };
          let goal = null;
          for (const dir of sides) {
            const p = mid.clone().addScaledVector(dir, dist);
            p.y = mid.y + aim.twoUp;
            const floor = r.ctx.groundHeight?.(p.x, p.z);
            if (Number.isFinite(floor) && p.y < floor + 1.6) p.y = floor + 1.6;
            if (sees(p)) { goal = p; break; }
          }
          S.twoShot = Boolean(goal);
          S.deadPose = { from, goal: goal ?? from.clone(), look0: ahead, look1: mid };
        } else {
          S.deadPose = { from, goal: from.clone(), look0: ahead, look1: ahead };
        }
      }
      if (S.deadPose) {
        const u = Math.min(1, (k - S.dead) / (pace.settle * FPS));
        const e = u * u * (3 - 2 * u);
        const pos = S.deadPose.from.clone().lerp(S.deadPose.goal, e);
        const dir = S.deadPose.look0.clone().lerp(S.deadPose.look1, e).sub(pos);
        const free = r.camera.free;
        free.pos.copy(pos);
        free.yaw = Math.atan2(-dir.x, -dir.z);
        free.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y / dir.length())));
      }
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
      // Each kill as it lands: the count, the feed, whether he was seen.
      const me = place(S.pid);
      const landed = S.kills.filter(x => x.t <= r.time).length;
      while (S.count < S.before + landed) {
        const kill = S.kills[S.count - S.before];
        S.count++;
        S.hitAt = k;
        S.hits.push({ frame: k, index: S.count, seen: window.__clean?.(kill.victim, kill.t - 0.1) ?? true });
        S.feed.push({ k, killer: S.name, weapon: kill.weaponShown, victim: kill.victimShown, kc: D.GOLD, vc: D.RED });
      }
      if (S.dead === k) S.feed.push({ k, killer: S.killerShown, weapon: S.endWeapon, victim: S.name, kc: D.RED, vc: D.GOLD });
      const cv = (window.__reelCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
      const g = cv.getContext('2d');
      const grey = S.dead === null ? 0 : Math.min(1, (k - S.dead) / (pace.grey * FPS));
      g.filter = grey > 0 ? `grayscale(${grey}) contrast(${1 + 0.2 * grey}) brightness(${1 - 0.15 * grey})` : 'none';
      g.drawImage(window.__renderer.domElement, 0, 0, W, H);
      g.filter = 'none';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // Tags over heads: red for the men he kills and the man who kills him,
      // a gold marker over him (his name once he is down).
      const project = (p, up) => {
        const v = cam.position.clone().set(p[0], p[1] + up, p[2]).project(cam);
        return v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 ? [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H] : null;
      };
      for (const v of S.kills) {
        const dt = r.time - v.t;
        if (dt < -pace.tagBefore || dt > pace.tagAfter) continue;
        const p = place(v.victim);
        const xy = p && project(p, 2.1);
        if (xy) D.tag(g, xy[0], xy[1], v.victimShown, D.RED, Math.max(0, Math.min(1, (pace.tagAfter - dt) / 0.3)));
      }
      if (S.death !== null && S.killer !== null && r.time >= S.death - 3) {
        const p = place(S.killer);
        const xy = p && project(p, 2.1);
        if (xy) D.tag(g, xy[0], xy[1], S.killerShown, D.RED);
      }
      if (me) {
        const xy = project(me, S.dead === null ? 2.1 : 1.2);
        if (xy) D.tag(g, xy[0], xy[1], S.dead === null ? null : S.name, D.GOLD, 0.95);
      }
      D.name(g, W, 202 + top, S.name, S.side);
      // Kills between the last take and this one roll by as it fades in.
      const rollN = S.rollFrom !== null ? Math.max(8, Math.min(30, 6 + 2 * (S.before - S.rollFrom))) : 0;
      const rolled = S.rollFrom !== null && S.rollFrom < S.before && S.hitAt < 0 && k < rollN
        ? Math.round(S.rollFrom + (S.before - S.rollFrom) * (k / rollN)) : null;
      if (rolled !== null) window.__streakBadge(g, W, 310 + top, rolled, rolled, -1);
      else window.__streakBadge(g, W, 310 + top, S.hitAt < 0 ? S.count : S.count - 1, S.count, S.hitAt < 0 ? -1 : k - S.hitAt);
      const rows = S.feed.filter(f => k - f.k < pace.feedFrames).slice(-3)
        .map(f => ({ ...f, alpha: Math.max(0, Math.min(1, (k - f.k + 1) / 4, (pace.feedFrames - (k - f.k)) / 10)) }));
      if (rows.length) D.feed(g, W, 420 + top, rows);
      if (S.title && k < pace.title) {
        D.caption(g, W, pace.caption, [[{ text: S.title[0] }], [{ text: S.title[1], colour: D.GOLD }]], Math.min(1, (pace.title - k) / 10));
      }
      if (S.dead !== null) {
        const lines = [[{ text: S.killerShown, colour: D.RED }, { text: ' ends it' }]];
        if (S.nemesis >= 2) lines.push([{ text: 'after ' }, { text: S.name, colour: D.GOLD }, { text: ` killed them ${S.nemesis} times` }]);
        D.caption(g, W, pace.caption, lines, Math.min(1, (k - S.dead + 1) / 8));
      }
      // In from black.
      if (k < dip) {
        g.fillStyle = `rgba(0,0,0,${1 - (k + 1) / (dip + 1)})`;
        g.fillRect(0, 0, W, H);
      }
      const end = S.death !== null ? S.dead !== null && k - S.dead >= pace.hold * FPS : r.time >= S.t1;
      return { at, end, url: cv.toDataURL('image/jpeg', 0.92) };
    }, { W, H, FPS, k, pace: STRETCH_PACE, top: OVERLAY_TOP, dip: DIP.in, aim: AIM });
    if (from === null) from = res.at;
    frames.push(res.url);
    framesWritten++;
    if (res.end) break;
  }
  const to = await page.evaluate(() => { window.__director?.remove(); window.replay.speed = 1; return window.__audioT?.() ?? null; });
  const { hits, dead, aimed, twoShot } = await page.evaluate(() => ({ hits: window.__stretchSt.hits, dead: window.__stretchSt.dead,
    aimed: window.__stretchSt.aimed ?? 0, twoShot: window.__stretchSt.twoShot ?? null }));
  const whys = await page.evaluate(() => (window.__cleanWhy ?? []).splice(0));
  if (whys.length) log(`    unseen: ${whys.join('; ')}`);
  const seen = hits.length ? hits.filter(h => h.seen).length / hits.length : 1;
  log(`    stretch ${s.t0.toFixed(1)}-${end.toFixed(1)}: ${base.toFixed(2)}x between kills, ${frames.length} frames, ${hits.length} kills, ${Math.round(seen * 100)}% seen, ${aimed} frames aimed${s.ending ? `, death at frame ${dead}, ${twoShot ? 'two-shot' : 'no clear two-shot'}` : ''}`);
  return { frames, hits, seen, audio: from !== null && to !== null ? [from, to] : null };
}

/** The stretch style's page helpers: the overlay, the clean test and the
 *  battles module they read places from. */
async function installStreakDraw(page) {
  await page.evaluate(STREAK_DRAW);
  await page.evaluate(async src => {
    window.__rbSync ??= await import(new URL('replay-battles.js', location.href).href);
    (0, eval)(src);
  }, CLEAN_TEST);
}

/** Frames the count takes to roll from `from` to `to`: a few kills quickly,
 *  many over up to a second. */
const rollFrames = (from, to) => Math.max(8, Math.min(30, 6 + 2 * (to - from)));
/** Seconds of lead before each shot of a streak after its first: the same
 *  place again needs less (rafal_pl's bunker, five times over its turret). */
const STREAK_LEAD = 1.2;
/** Seconds of his life before his death the ending take shows. */
const STRETCH_END_LEAD = 3.5;

/** A streak's stretches filmed one after another into `write`, joined by
 *  the dip (the fast play between kills says the time went by; the owner,
 *  2026-11-04: a "+0:12" card "doesn't really add value"); each kill's hit
 *  goes to `marks` for the cold open,
 *  scored on what reads in it (close, two at once, the man who ends it). */
async function filmStretches(page, reel, write, at, marks, audio) {
  await installStreakDraw(page);
  let prev = null;
  for (const [i, s] of reel.stretches.entries()) {
    const before = s.kills.length ? s.kills[0].streakIndex - 1 : reel.total;
    const rollFrom = prev ? prev.kills.at(-1)?.streakIndex ?? null : null;
    const take = await filmStretch(page, reel, s, { first: i === 0, before, rollFrom });
    const out = await dipOut(page, take.frames);
    const start = at();
    for (const url of out.frames) write(url);
    if (take.audio) audio.push([take.audio[0], take.audio[1] - out.dropped / FPS]);
    for (const h of take.hits) {
      if (!take.audio || h.frame >= out.frames.length - DIP.ramp - DIP.out) continue;
      const k = s.kills[h.index - before - 1];
      const pair = s.kills.some(o => o !== k && Math.abs(o.t - k.t) <= 1);
      const close = k.distance !== null && k.distance <= 30 ? 40 - k.distance : 0;
      const cold = h.seen ? close + (pair ? 15 : 0) + (k.victim === reel.endedBy ? 10 : 0) : -100;
      marks.push({ start, end: at(), hit: start + h.frame, audioFrom: take.audio[0], score: cold, ending: s.ending });
    }
    prev = s;
  }
  return { ok: at() >= FPS, why: at() >= FPS ? null : `only ${at()} frames` };
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

/**
 * A compilation's close kills cut fast (the owner, 2026-11-09, lop|DriFt's
 * 8 in 59 s on Midway, filmed kill by kill as the bullet chase and 81 s
 * long: "they're all super tight (close quarters) so the slow down kind of
 * is annoying ... play it back in real time, and maybe use some different
 * angles and edits to keep it feeling fresh"). A kill on foot within
 * `maxDist` metres is two shots at 1x, cut hard on the action: the approach
 * from `before` seconds ahead of the kill, then the kill from `cut` seconds
 * before it to `after` past it. Each shot's angle turns over from kill to
 * kill (`approach`, `kill`: QUICK_SRC's poses), the kill's never the
 * approach's, the first of its list that the depth picture says is clear
 * (less than `wall` of it within `near` metres, less than `cover` within
 * `coverFar` metres or half the way to its subject, its subject seen), else the
 * chase as placed; it follows the men, eased over `ease` seconds. Kills
 * cut straight into one another; one after black comes in over `DIP.in`.
 */
const QUICK = Object.freeze({
  maxDist: 60, before: 1.9, cut: 0.3, after: 1.0, settle: 0.5, ease: 0.12, near: 1.2, wall: 0.25, cover: 0.35, coverFar: 4,
  approach: ['front', 'high', 'shoulder'], kill: ['reverse', 'shoulder', 'high'],
});
/** A kill the fast cut films: both men on foot, close. */
const quickKill = part => !part.killerVehicle && !part.victimVehicle && !part.flying && !part.victimFlying
  && Number.isFinite(Number(part.distance)) && Number(part.distance) <= QUICK.maxDist;
/** The fast cut's camera (`window.__quick`): the poses, picked per shot,
 *  placed each frame after the chase. */
const QUICK_SRC = `window.__quick = (() => {
  let st = null;
  return {
    install(o) {
      const r = window.replay;
      const B = window.__rbSync;
      const D = window.__depth;
      const cam = r.ctx.camera;
      const V = (x = 0, y = 0, z = 0) => cam.position.clone().set(x, y, z);
      const where = (pid, t) => B.whereIs(r.rec, pid, t, r.kills ?? r.rec.kills);
      st = { ...o, phase: -1, pos: null, look: null, kind: null, kinds: [] };
      // [where the lens is, what it looks at] from his eye K and his victim's chest Vp.
      const pose = (kind, K, Vp) => {
        const fwd = Vp.clone().sub(K).setY(0);
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
        fwd.normalize();
        const right = V(-fwd.z, 0, fwd.x);
        const s = st.side;
        if (kind === 'shoulder') return [K.clone().addScaledVector(fwd, -2.6).add(V(0, 0.5, 0)).addScaledVector(right, 0.6 * s), K.clone().lerp(Vp, 0.7)];
        if (kind === 'front') return [K.clone().addScaledVector(fwd, 3.2).add(V(0, -0.2, 0)).addScaledVector(right, 1.6 * s), K.clone().addScaledVector(fwd, 0.6)];
        if (kind === 'high') return [K.clone().addScaledVector(fwd, -5.5).add(V(0, 4.5, 0)).addScaledVector(right, 1.5 * s), K.clone().lerp(Vp, 0.6)];
        if (kind === 'reverse') return [Vp.clone().addScaledVector(fwd, 2.4).add(V(0, 0.5, 0)).addScaledVector(right, 0.8 * s), Vp.clone().lerp(K, 0.5)];
        return null;
      };
      // Clear: the lens not in a wall, little of the picture closer than
      // half the way to the subject (a hut's roof under the high pose), the
      // subject in the picture and seen (over his shoulder, a victim hidden
      // only by the shooter's own back counts as seen).
      const clearAt = (c, kind, [at, look], subject, K) => {
        const saved = [c.position.clone(), c.quaternion.clone()];
        c.position.copy(at);
        c.lookAt(look);
        c.updateMatrixWorld();
        let ok = false;
        if (D.take(c)) {
          const v = subject.clone().project(c);
          const inside = v.z < 1 && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.85;
          const drawn = D.at(subject, c);
          const far = at.distanceTo(subject);
          const own = kind === 'shoulder' && subject !== K && Math.abs(drawn - at.distanceTo(K)) < 1.2;
          ok = inside && D.near(st.cfg.near) < st.cfg.wall && D.near(Math.min(st.cfg.coverFar, far / 2)) < st.cfg.cover
            && (drawn >= far - 0.8 || own);
          // The high shot is the two of them: from over a roof it showed only
          // a small man on a slope, the shooter under the roof.
          if (ok && kind === 'high' && subject !== K) {
            const k = K.clone().project(c);
            ok = k.z < 1 && Math.abs(k.x) < 0.85 && Math.abs(k.y) < 0.85 && D.at(K, c) >= at.distanceTo(K) - 0.8;
          }
        }
        c.position.copy(saved[0]);
        c.quaternion.copy(saved[1]);
        c.updateMatrixWorld();
        return ok;
      };
      r.camera.setLensHook(c => {
        if (!st) return;
        const t = r.time;
        const kw = where(st.pid, t);
        const vw = where(st.victim, Math.min(t, st.t - 0.1));
        if (!kw?.pos || !vw?.pos) return;
        const K = V(kw.pos[0], kw.pos[1] + 1.5, kw.pos[2]);
        const Vp = V(vw.pos[0], vw.pos[1] + 1.1, vw.pos[2]);
        const phase = t < st.t - st.cfg.cut ? 0 : 1;
        if (phase !== st.phase) {
          st.phase = phase;
          const list = phase === 0 ? st.approach : st.kill;
          st.kind = null;
          for (const kind of list) {
            if (phase === 1 && kind === st.kinds[0]) continue;
            if (clearAt(c, kind, pose(kind, K, Vp), phase === 0 ? K : Vp, K)) { st.kind = kind; break; }
          }
          st.kinds.push(st.kind ?? 'chase');
          st.pos = null;
        }
        if (!st.kind) return;
        const [at, look] = pose(st.kind, K, Vp);
        if (!st.pos) {
          st.pos = at.clone();
          st.look = look.clone();
        } else {
          const k = 1 - Math.exp(-1 / (st.cfg.ease * 30));
          st.pos.lerp(at, k);
          st.look.lerp(look, k);
        }
        c.position.copy(st.pos);
        c.lookAt(st.look);
        c.updateMatrixWorld();
        c.matrixWorldInverse.copy(c.matrixWorld).invert();
      });
    },
    kinds() { return st?.kinds ?? []; },
    remove() {
      st = null;
      window.replay.camera.setLensHook(null);
    },
  };
})();`;

/** One close kill of a compilation in the fast cut (QUICK) into `write`:
 *  his name and the count on top as the burst draws them. `i` turns the
 *  angles over. `{ ok, audio, frames, hitFrame, kinds }`. */
async function filmQuick(page, reel, part, i, write, { fadeIn = 0 } = {}) {
  const counts = streakCounts(part, reel);
  const roll = (j, list) => [...list.slice(j % list.length), ...list.slice(0, j % list.length)];
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
  }, { from: part.t - QUICK.before - QUICK.settle, pid: part.killer });
  await page.waitForTimeout(600);
  await page.evaluate(async ({ src, depth }) => {
    window.__rbSync ??= await import(new URL('replay-battles.js', location.href).href);
    if (!window.__quick) (0, eval)(src);
    if (!window.__depth) (0, eval)(depth);
    await window.__depth.ready();
    window.replay.playing = true;
  }, { src: QUICK_SRC, depth: DEPTH_SRC });
  for (let k = 0; k < Math.round(QUICK.settle * FPS); k++) {
    await page.evaluate(async ({ W, H, FPS }) => {
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
    }, { W, H, FPS });
  }
  await page.evaluate(o => window.__quick.install(o), {
    pid: part.killer, victim: part.victim, t: part.t, side: i % 2 ? -1 : 1,
    approach: roll(i, QUICK.approach), kill: roll(i, QUICK.kill), cfg: QUICK,
  });
  let from = null;
  let n = 0;
  let hitFrame = null;
  for (let k = 0; k < MAX_FRAMES; k++) {
    const res = await page.evaluate(async ({ W, H, FPS, t, end, name, top, before, after, hitFrame, n, fadeIn }) => {
      const r = window.replay;
      const at = window.__audioT?.() ?? null;
      window.__clock.step(1000 / FPS);
      window.__renderOnce(W, H, 1 / FPS);
      await window.__audioStep?.(1 / FPS);
      const hit = r.time >= t;
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
      const since = hitFrame === null ? (hit ? 0 : -1) : n - hitFrame;
      window.__streakBadge(g, W, 310 + top, before, after, since, 'KILLS');
      if (n < fadeIn) {
        g.fillStyle = 'rgba(0,0,0,' + (1 - n / fadeIn) + ')';
        g.fillRect(0, 0, W, H);
      }
      return { at, hit, done: r.time >= end, url: cv.toDataURL('image/jpeg', 0.92) };
    }, { W, H, FPS, t: part.t, end: part.t + QUICK.after, name: reel.playerName ?? '', top: OVERLAY_TOP,
      before: counts.before, after: counts.after, hitFrame, n, fadeIn });
    if (from === null) from = res.at;
    if (hitFrame === null && res.hit) hitFrame = n;
    write(res.url);
    n++;
    framesWritten++;
    if (res.done) break;
  }
  const kinds = await page.evaluate(() => { const k = window.__quick?.kinds() ?? []; window.__quick?.remove(); return k; });
  log(`    kill ${counts.after} at ${part.t.toFixed(1)} (${Math.round(part.distance)} m): ${kinds.join(' / ')}, ${n} frames`);
  if (n < FPS) return { ok: false, why: `only ${n} frames` };
  return { ok: true, frames: n, hitFrame, kinds, audio: from === null ? null : [from, from + n / FPS] };
}

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
  if (reel.streak) await installStreakDraw(page);
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
    // The one take behind him is kept behind --burst-take: kill by kill, the
    // close ones in the fast cut (QUICK), is the default (2026-11-09).
    const oneTake = args.includes('--burst-take');
    const take = reel.inHull || !oneTake ? null : await filmBurst(page, reel);
    if (take && take.seen >= CLEAN.share && take.roomy >= DIRECTOR.roomy) {
      for (const url of take.frames) write(url);
      if (take.audio) audio.push(take.audio);
    } else {
      log(`    burst ${reel.inHull ? 'from a hull' : !oneTake ? 'in the fast cut' : `take saw ${Math.round((take?.seen ?? 0) * 100)}% of its kills, ${Math.round((take?.roomy ?? 0) * 100)}% from the chase`}: filmed kill by kill`);
      burstParts = reel.shots ?? [];
      if (burstParts.length < 3) return { ok: false, why: 'its kills cannot be filmed one by one' };
    }
    cleanScore = take?.seen ?? null;
  }
  if (reel.asmr) {
    let kept = 0;
    for (const part of reel.parts) {
      const got = part.beat ? await filmArsenalTake(page, part, write) : await filmTake(page, part, write);
      if (got.audio) audio.push(got.audio);
      if (!got.left) kept++;
    }
    // One moment alone is a clip, not ASMR; a mix piece of one is fine.
    if (kept < (reel.arsenal ? 1 : Math.min(2, reel.parts.length))) return { ok: false, why: `only ${kept} of its moments can be seen` };
  }
  // A streak's last part is the kill that ended it, when it can be filmed.
  // A streak on foot is its stretches, one take each (filmStretches).
  const stretched = Boolean(reel.streak && reel.stretches?.length);
  // A streak's ending is filmed from his side when the recording holds him
  // (filmStretch's ending take); else the killer's shot, as before.
  const endTake = Boolean(reel.streak && !stretched && reel.endTake);
  const parts = reel.burst ? burstParts ?? [] : reel.asmr || stretched ? []
    : reel.streak && reel.ending && !endTake ? [...reel.parts, { ...reel.ending, ending: true }]
      : reel.parts;
  // Each part's frames and its hit, for the cold open.
  const marks = [];
  let mapCardsShown = 0;
  if (stretched) {
    const got = await filmStretches(page, reel, write, () => n, marks, audio);
    if (!got.ok) return got;
  }
  for (const [i, part] of parts.entries()) {
    // A long way between two of one player's kills: the map card, the route
    // he took and how long (EDITS.md, the context bridge).
    if (i > 0 && (reel.player !== undefined || reel.streak) && !reel.air && part.t - parts[i - 1].t >= MAP_CARD.gap
      && !(part.air || parts[i - 1].air || part.flying || parts[i - 1].flying)) {
      const card = await mapCard(page, reel, parts[i - 1], part, { shown: mapCardsShown });
      if (card?.length) {
        mapCardsShown++;
        for (const url of card) write(url);
        audio.push([-100, -100 + card.length / FPS]);
      }
    }
    // A burst's close kill on foot: the fast cut, real time, two angles.
    // One with no round to chase (the picker's `noRound`) can only be this.
    const quick = p => p && (p.noRound || quickKill(p));
    if (reel.burst && part.mode === 'shot' && quick(part)) {
      const got = await filmQuick(page, reel, part, i, write, { fadeIn: i === 0 || !quick(parts[i - 1]) ? DIP.in : 0 });
      if (got.ok && got.audio) audio.push(got.audio);
      if (!got.ok) log(`    part ${i + 1} left out: ${got.why}`);
      continue;
    }
    // A vehicle kill in a compilation is the bullet chase: one round, the
    // shot and the death one clip (the owner, 2026-11-03: the volley "cuts
    // off the shot and the death of the victim feels like a completely
    // unrelated clip"). Air kills stay the volley.
    if (part.mode === 'shot') {
      const held = [];
      const counts = reel.streak || reel.burst ? streakCounts(part, reel) : null;
      const prevIndex = i > 0 ? parts[i - 1].streakIndex : null;
      const shot = await shootKill(page, part, url => held.push(url), {
        top: OVERLAY_TOP,
        streak: counts, word: reel.burst ? 'KILLS' : undefined,
        name: reel.playerName ?? null, label: reel.streak ? (endTake ? null : streakLabel(part, reel)) : reel.burst ? null : partLabel(i, reel.parts.length, part, reel), fadeIn: DIP.in,
        // A streak's shot in the stretch style (STREAK_REVIEW.md): his side,
        // the man he kills tagged, the feed row on the hit, the count rolling
        // through the kills between this shot and the last.
        ...(reel.streak && !part.ending ? {
          side: reel.side ?? null,
          tag: { pid: part.victim, t: part.t, name: part.victimName ?? '', hull: Boolean(part.victimVehicle) },
          feed: { killer: reel.playerName ?? '', weapon: part.weapon ?? part.killerVehicle ?? null, victim: part.victimName ?? '' },
          roll: prevIndex !== null && counts && prevIndex < counts.before ? { from: prevIndex, frames: rollFrames(prevIndex, counts.before) } : null,
          title: i === 0 ? [`${reel.total} kill streak`, `on ${P.levelWords(reel.level)}`] : null,
        } : {}),
      }, { lead: reel.streak && i > 0 ? STREAK_LEAD : null });
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
  // His death from his side: over his shoulder (or his hull) toward the man
  // who kills him, then both men, grey (filmStretch's ending).
  if (endTake && n >= FPS) {
    const s = { t0: reel.endedAt - STRETCH_END_LEAD, t1: reel.endedAt, kills: [], ending: true };
    const take = await filmStretch(page, reel, s, { before: reel.total });
    const out = await dipOut(page, take.frames);
    for (const url of out.frames) write(url);
    if (take.audio) audio.push([take.audio[0], take.audio[1] - out.dropped / FPS]);
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
        g.fillText(burst ? `kills in ${burst} seconds` : 'kill streak', W / 2, H / 2 + 150);
        if (!burst) {
          g.fillStyle = 'rgba(246,241,226,0.75)';
          g.font = '700 46px system-ui, "Segoe UI", sans-serif';
          g.fillText(by ? `Ended by ${by}` : endedAt === null ? 'Still going at the end of the round' : 'Ended by their own hand', W / 2, H / 2 + 250);
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
  let posterAt = null;
  // A compilation opens on its best hit (EDITS.md, the cold open), and each
  // part's sound comes in just before its picture (the J-cut).
  if ((reel.player !== undefined || reel.streak) && !reel.burst && marks.length >= 3) {
    // A streak's opens on a hit from its later half: a look ahead at where
    // the count is going (from its kill 3, it read as the count going back
    // to 2 in the first part).
    const pool = reel.streak ? marks.filter((m, i, all) => !m.ending && i >= Math.floor(all.filter(x => !x.ending).length / 2)) : marks;
    const was = n;
    n = await coldOpen(page, frames, n, pool.length ? pool : marks, audio);
    if (stretched) posterAt = n > was ? COLD.before + 8 : (marks[0]?.hit ?? 0) + 8;
  }
  jCut(audio);
  const mp4 = path.join(dir, 'short.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.jpg'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-maxrate', '12M', '-bufsize', '24M',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  // The poster: the first death's hold, before its fade.
  const p0 = reel.parts[0];
  const lead = reel.burst || reel.asmr ? 1 : p0.kind === 'spawn-death' ? p0.lived : reel.player !== undefined ? REEL_BEAT.playerLead : p0.mode === 'volley' ? REEL_BEAT.volleyLead : REEL_BEAT.lead;
  const at = Math.min(n - 1, posterAt ?? Math.round((lead + 0.5) * FPS + 10));
  const poster = path.join(dir, 'poster.jpg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(frames, `f${String(at).padStart(4, '0')}.jpg`),
    '-vf', 'scale=540:960', '-q:v', '4', poster]);
  fs.rmSync(frames, { recursive: true, force: true });
  const names = await page.evaluate(({ kv, vv, weapon }) => {
    const c = window.replay.creator;
    const d = s => (s ? c.display(s) || s : null);
    return { killerVehicle: d(kv), victimVehicle: d(vv), weapon: d(weapon) };
  }, { kv: reel.parts[0].killerVehicle ?? null, vv: reel.parts[0].victimVehicle ?? null, weapon: reel.parts[0].weapon ?? null });
  return { ok: true, mp4, poster, audio: audio.length ? audio : null, frames: n, edited: n, asmr: Boolean(reel.asmr),
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
 * A kill shot's slow motion in a Short (the owner, 2026-11-09: "in general
 * we're slowing down too much in the slow mo"). The studio's 'strong' bullet
 * time gives every round 2.5 s on screen however short its flight, so a 20 m
 * SMG kill crawled; here the round's time on screen grows with the distance,
 * `flightBase + metres / flightPerM` seconds (clamped to `flightMin`..
 * `flightMax`), and the hold on the hit is shorter and less slowed (`hold`,
 * the round cam's `hold` override).
 */
const SHORT_PACE = Object.freeze({
  pace: 90, flightBase: 0.35, flightPerM: 250, flightMin: 0.45, flightMax: 1.4,
  hold: Object.freeze({ real: 1.0, speed: 0.6, max: 2.5, pastKill: 0.7, hullReal: 2.6, hullMax: 4, hullSpeed: 0.75 }),
});
/** The round's seconds on screen in a Short, by the kill's distance. */
const shortFlight = metres => Math.min(SHORT_PACE.flightMax,
  Math.max(SHORT_PACE.flightMin, SHORT_PACE.flightBase + (Number(metres) > 0 ? Number(metres) : 0) / SHORT_PACE.flightPerM));

/**
 * The creator's one-click kill shot of `cand` (the bullet chase, the Shorts
 * look), each recorded frame handed to `write` as a data URL. `overlay`
 * (`{ name, label, fadeIn }`) draws a compilation's player name and count over
 * it and fades its first frames in from black. `{ ok, frames, hitFrame,
 * audio: [from, to], kill, names }`.
 */
async function shootKill(page, cand, write, overlay = null, { lead = null } = {}) {
  await armCreator(page, { lower: !overlay });
  await page.evaluate(({ pace, flight, hold }) => {
    const ro = window.replay.creator.rounds;
    ro.bulletTime = { pace, flight };
    ro.hold = hold;
  }, { pace: SHORT_PACE.pace, flight: shortFlight(cand.distance), hold: SHORT_PACE.hold });
  // A shorter lead-in than the look's (a streak's later shots).
  if (lead !== null) await page.evaluate(l => { window.replay.creator.prefs.leadIn = l; }, lead);
  await page.evaluate(() => { delete window.__streakHitAt; });
  // The over-the-shoulder shot before the round leaves follows the camera's
  // rules too (the owner, 2026-11-04: a church's walls hid n.o.i.c.e's kills;
  // "tighter, almost at their POV"). Installed once the take is armed, over
  // the creator's own lens hook, and only while the round cam waits armed.
  const director = async on => page.evaluate(async ({ on, src, depth, pid, victim, t, air, fromAir, victimHull, cfg }) => {
    const r = window.replay;
    if (!on) { const fl = window.__director?.flightLog?.() ?? null; window.__director?.remove(); return fl; }
    window.__rbSync ??= await import(new URL('replay-battles.js', location.href).href);
    if (!window.__director) (0, eval)(src);
    if (!window.__depth) (0, eval)(depth);
    await window.__depth.ready();
    // The flight and the hold after the hit: drawn back, the hold backed into
    // a wall as often as the flight flew behind one.
    const flight = () => r.creator.rounds?.state === 'flying' || r.creator.rounds?.state === 'impact';
    flight.victim = victim;
    flight.t = t;
    flight.air = air;
    flight.fromAir = fromAir;
    flight.victimHull = victimHull;
    window.__director.install(pid, [], cfg, { chain: r.camera.lensHook, when: () => r.creator.rounds?.state === 'armed', flight });
  }, { on, src: DIRECTOR_SRC, depth: DEPTH_SRC, pid: cand.killer, victim: cand.victim, t: cand.t, air: Boolean(cand.victimFlying), fromAir: Boolean(cand.flying),
    victimHull: Boolean(cand.victimVehicle),
    cfg: { ...DIRECTOR, shoulderOnly: true, reveal: overlay ? null : REVEAL } });
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
  await director(true);
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
          const D = window.__streakDraw;
          const r = window.replay;
          if (overlay.streak) {
            if (out.state === 'impact' && window.__streakHitAt === undefined) window.__streakHitAt = n;
            const since = window.__streakHitAt === undefined ? -1 : n - window.__streakHitAt;
            // The kills since the last shot roll by on the count as it fades in.
            const roll = overlay.roll;
            if (roll && window.__streakHitAt === undefined && n < roll.frames) {
              const v = Math.round(roll.from + (overlay.streak.before - roll.from) * (n / roll.frames));
              window.__streakBadge(g, W, 310 + overlay.top, v, v, -1, overlay.word);
            } else {
              window.__streakBadge(g, W, 310 + overlay.top, overlay.streak.before, overlay.streak.after, since, overlay.word);
            }
          }
          if (D && (overlay.tag || overlay.feed || overlay.title)) {
            const V = (window.__vp ??= await import(new URL('vehicle-players.js', location.href).href));
            const shown = x => (x && V.decodePlayerName ? V.decodePlayerName(x) : x ?? '');
            // The man he kills, tagged red until a moment after he dies.
            const tag = overlay.tag;
            const dt = tag ? r.time - tag.t : Infinity;
            if (tag && dt > -3 && dt < 0.8 && window.__rbSync) {
              const w = window.__rbSync.whereIs(r.rec, tag.pid, Math.min(r.time, tag.t - 0.1), r.kills ?? r.rec.kills);
              const cam = r.ctx.camera;
              if (w?.pos) {
                const v = cam.position.clone().set(w.pos[0], w.pos[1] + (tag.hull ? 3.2 : 2.1), w.pos[2]).project(cam);
                if (v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05) {
                  D.tag(g, ((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H, shown(tag.name), D.RED, Math.max(0, Math.min(1, (0.8 - dt) / 0.3)));
                }
              }
            }
            // The kill feed row, from the hit.
            const age = window.__streakHitAt === undefined ? -1 : n - window.__streakHitAt;
            if (overlay.feed && age >= 0 && age < 75) {
              const f = overlay.feed;
              D.feed(g, W, 420 + overlay.top, [{ killer: shown(f.killer), weapon: f.weapon ? c.display(f.weapon) || f.weapon : '', victim: shown(f.victim),
                kc: D.GOLD, vc: D.RED, alpha: Math.max(0, Math.min(1, (age + 1) / 4, (75 - age) / 10)) }]);
            }
            if (overlay.title && n < 60) {
              D.caption(g, W, 1420, [[{ text: overlay.title[0] }], [{ text: overlay.title[1], colour: D.GOLD }]], Math.min(1, (60 - n) / 10));
            }
          }
          if (overlay.name && overlay.side !== undefined && D) {
            const V = (window.__vp ??= await import(new URL('vehicle-players.js', location.href).href));
            D.name(g, W, 202 + overlay.top, V.decodePlayerName ? V.decodePlayerName(overlay.name) : overlay.name, overlay.side);
          } else if (overlay.name) {
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
  const flightLog = await director(false);
  if (args.includes("--debug-director")) log(`    flight ${cand.t.toFixed(1)}: ${JSON.stringify(flightLog)}`);
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
  const t0 = Date.now();
  const wavs = await page.evaluateLong(({ ranges, spf }) => window.__audioWavs(ranges, spf), { ranges: done.map(d => d.made.audio ?? []), spf: AUDIO_RATE / FPS }, SOUND_TIMEOUT);
  log(`    sound rendered in ${Math.round((Date.now() - t0) / 1000)} s`);
  done.forEach(({ made, dir }, i) => {
    if (!wavs[i]) return;
    const wav = path.join(dir, 'sound.wav');
    fs.writeFileSync(wav, Buffer.from(wavs[i], 'base64'));
    const silent = path.join(dir, 'silent.mp4');
    fs.renameSync(made.mp4, silent);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-af', made.asmr ? `${ASMR_SOUND},apad` : 'apad', '-shortest', '-movflags', '+faststart', made.mp4]);
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

/** --asmr-mix=<clip|automatic|cannon|under-fire>: one Battlefield ASMR
 *  Short of a theme across the rounds, with two moments of rounds going past
 *  a man between its pieces (picker `asmrWeekOf`); under-fire is those alone. */
const MIX = opt('asmr-mix', null);
const MIX_TITLES = Object.freeze({ clip: 'Garand pings', automatic: 'machine guns', cannon: 'big guns', 'under-fire': 'rounds going past' });

/** --asmr-mix=week: the week's one ASMR (the owner, 2026-11-04: "1 asmr
 *  clip a week"), its theme taking turns by the week of the year. */
function weekTheme(now = new Date()) {
  const week = Math.floor((now.getTime() / 86400000 + 3) / 7);
  const themes = Object.keys(MIX_TITLES);
  return themes[week % themes.length];
}

/** Whether a mod's rounds crack past a listener at all: its shared effect
 *  sounds carry a round's script with a passing crack (`approachesListener`).
 *  A table without one makes every under-fire moment silent: vanilla's live
 *  table was such until its re-export on 2026-11-07
 *  (features/flyby-bullet-cracks). */
const crackTables = new Map();
async function modCracks(mod) {
  const m = String(mod ?? '').toLowerCase();
  if (!crackTables.has(m)) {
    const url = `${PLAY}/maps/${m === 'bf1942' ? '' : `mods/${m}/`}_shared/effects.sounds.json`;
    crackTables.set(m, fetchRetry(url).then(r => (r.ok ? r.json() : null)).then(t => !t || Object.entries(t.scripts ?? {})
      .some(([k, sc]) => k.endsWith('#flight') && (sc.layers ?? []).some(l => l.trigger === 'volume'
        && (l.modulators ?? []).some(x => x.dest === 'volume' && x.source === 'distance')))).catch(() => true));
  }
  return crackTables.get(m);
}

/**
 * The week's Battlefield ASMR is the arsenal (the owner, 2026-11-07: it
 * replaces the mix of moments from the replays): the week's guns (picker
 * `arsenalOf`), each cut out of its round into a range recording and filmed
 * in two beats (`filmArsenalTake`), one page a round, joined in turn.
 */
async function filmArsenal() {
  const recs = await recordingsToDo();
  const rounds = [];
  for (const r of recs) {
    const res = await fetchRetry(`${API}${r.recordingUrl}`);
    if (!res.ok) continue;
    const text = await res.text();
    const rec = R.parseRecording(text);
    if (!rec.kills?.length) continue;
    rounds.push({ slug: r.slug, r, text, moments: P.asmrMomentsOf(rec, { ejects: new Set(ejectsOf(r.mod)) }) });
  }
  const list = P.arsenalOf(rounds);
  if (!list) {
    log(`arsenal: too few guns across ${rounds.length} rounds`);
    return;
  }
  log(`arsenal: ${list.length} guns from ${new Set(list.map(m => m.slug)).size} rounds: ${list.map(m => m.weapon).join(', ')}`);
  const dir = path.join(OUT, 'asmr-arsenal');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const pieces = new Map();
  for (const slug of [...new Set(list.map(m => m.slug))]) {
    const round = rounds.find(x => x.slug === slug);
    const items = list.filter(m => m.slug === slug);
    const rangePath = `/stats/recordings/range-${slug}.ndjson`;
    RANGES.set(rangePath, rangeRecording(round.text, items.map(m => ({ id: m.nid, weapons: [m.weapon], from: m.t0, to: m.t1 }))));
    let page = null;
    try {
      page = await openPage(browser, playUrl({ ...round.r, recordingUrl: rangePath }));
      const done = [];
      for (const m of items) {
        const pdir = path.join(dir, `${slug}-${m.t.toFixed(2)}`);
        fs.mkdirSync(pdir, { recursive: true });
        phase = `filming the arsenal's ${m.weapon} on ${slug}`;
        const made = await filmReel(page, { reel: true, asmr: true, arsenal: true, level: round.r.level,
          parts: [{ ...m, beat: 'report' }, { ...m, beat: 'whizz' }] }, pdir);
        if (made.ok) done.push({ made, dir: pdir, m });
      }
      if (done.some(d => d.made.audio)) await addSound(page, done);
      for (const d of done) pieces.set(d.m, d.made);
    } finally {
      RANGES.delete(rangePath);
      if (page) await withTimeout(page.close(), 15000, 'closing the page').catch(() => {});
    }
  }
  const order = list.filter(m => pieces.has(m));
  for (const m of order) log(`  piece ${m.slug} at ${m.t.toFixed(1)}: ${m.weapon} on ${m.platform}`);
  if (order.length < P.ARSENAL.min) {
    log(`arsenal: only ${order.length} guns filmed`);
    return;
  }
  const listFile = path.join(dir, 'pieces.txt');
  fs.writeFileSync(listFile, order.map(m => `file '${pieces.get(m).mp4}'`).join('\n'));
  const mp4 = path.join(dir, 'short.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', mp4]);
  const poster = pieces.get(order[0]).poster;
  const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }));
  const first = order[0];
  const r0 = rounds.find(x => x.slug === first.slug).r;
  const meta = {
    recordingSlug: first.slug, killTime: Number(first.t.toFixed(2)), victimPid: -7, kind: 'asmr',
    title: 'Battlefield ASMR: the arsenal', killer: '', victim: '', weapon: '', killerVehicle: null, victimVehicle: null,
    distance: 0, lengthSeconds: Math.round(secs * 10) / 10, level: r0.level, mod: r0.mod,
    victims: [...new Set(order.map(m => m.playerName).filter(Boolean))],
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  log(`  filmed "${meta.title}" from ${order.length} guns, ${secs.toFixed(1)} s, ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);
  let slug = null;
  if (UPLOAD) {
    try {
      slug = (await upload(meta, { mp4, poster })).slug;
      log(`  uploaded ${slug} "${meta.title}"`);
    } catch (e) {
      log(`  upload failed for "${meta.title}": ${e.message}`);
    }
  }
  summary.push({ recording: first.slug, title: meta.title, kind: 'asmr', dir, slug });
}

async function filmAsmrMix(what) {
  if (!MIX_TITLES[what]) throw new Error(`--asmr-mix takes ${Object.keys(MIX_TITLES).join(', ')}`);
  const recs = await recordingsToDo();
  const rounds = [];
  for (const r of recs) {
    const res = await fetchRetry(`${API}${r.recordingUrl}`);
    if (!res.ok) continue;
    const rec = R.parseRecording(await res.text());
    if (!rec.kills?.length) continue;
    const underFire = await modCracks(r.mod) ? P.underFireMomentsOf(rec) : [];
    rounds.push({ slug: r.slug, r, moments: [...P.asmrMomentsOf(rec, { ejects: new Set(ejectsOf(r.mod)) }), ...underFire] });
  }
  const mix = P.asmrWeekOf(rounds, what);
  if (!mix) {
    log(`asmr mix ${what}: too few moments across ${rounds.length} rounds`);
    return;
  }
  log(`asmr mix ${what}: ${mix.length} moments from ${new Set(mix.map(m => m.slug)).size} rounds`);
  const dir = path.join(OUT, `asmr-mix-${what}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const pieces = new Map();
  // Each round's moments in that round's page, each its own piece with sound.
  for (const slug of [...new Set(mix.map(m => m.slug))]) {
    const round = rounds.find(x => x.slug === slug);
    let page = null;
    try {
      page = await openPage(browser, playUrl(round.r));
      const done = [];
      for (const m0 of mix.filter(x => x.slug === slug)) {
        // An under-fire moment that cannot be seen (his cover between the
        // lens and the guns) gives way to the round's next best.
        const tries = m0.what !== 'under-fire' ? [m0] : [m0, ...round.moments
          .filter(x => x.what === 'under-fire' && !mix.some(y => y.slug === slug && Math.abs(y.t - x.t) < 10))
          .sort((a, b) => b.score - a.score).slice(0, 2).map(x => ({ ...x, slug }))];
        for (const m of tries) {
          const pdir = path.join(dir, `${slug}-${m.t.toFixed(2)}`);
          fs.mkdirSync(pdir, { recursive: true });
          phase = `filming the ${what} mix at ${m.t.toFixed(1)} on ${slug}`;
          const made = await filmReel(page, { reel: true, asmr: true, parts: [m], level: round.r.level }, pdir);
          if (!made.ok) continue;
          if (m !== m0) mix.splice(mix.indexOf(m0), 1, m);
          done.push({ made, dir: pdir, m });
          break;
        }
      }
      if (done.some(d => d.made.audio)) await addSound(page, done);
      for (const d of done) pieces.set(d.m, d.made);
    } finally {
      if (page) await withTimeout(page.close(), 15000, 'closing the page').catch(() => {});
    }
  }
  const order = mix.filter(m => pieces.has(m));
  for (const m of order) log(`  piece ${m.what} ${m.slug} at ${m.t.toFixed(1)}: ${m.weapon}${m.what === 'under-fire' ? `, ${m.shots.length} rounds past ${m.playerName}` : ''}`);
  if (order.length < P.ASMR_MIX.min) {
    log(`asmr mix ${what}: only ${order.length} pieces filmed`);
    return;
  }
  // One video of the pieces in turn, encoded through so they all match.
  const list = path.join(dir, 'pieces.txt');
  fs.writeFileSync(list, order.map(m => `file '${pieces.get(m).mp4}'`).join('\n'));
  const mp4 = path.join(dir, 'short.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', mp4]);
  const poster = pieces.get(order[0]).poster;
  const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }));
  const first = order[0];
  const r0 = rounds.find(x => x.slug === first.slug).r;
  const meta = {
    recordingSlug: first.slug, killTime: Number(first.t.toFixed(2)), victimPid: -6, kind: 'asmr',
    title: `Battlefield ASMR: ${MIX_TITLES[what]}`, killer: '', victim: '', weapon: '', killerVehicle: null, victimVehicle: null,
    distance: 0, lengthSeconds: Math.round(secs * 10) / 10, level: r0.level, mod: r0.mod,
    victims: [...new Set(order.map(m => m.playerName).filter(Boolean))],
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  log(`  filmed "${meta.title}" from ${order.length} pieces, ${secs.toFixed(1)} s, ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);
  let slug = null;
  if (UPLOAD) {
    try {
      slug = (await upload(meta, { mp4, poster })).slug;
      log(`  uploaded ${slug} "${meta.title}"`);
    } catch (e) {
      log(`  upload failed for "${meta.title}": ${e.message}`);
    }
  }
  summary.push({ recording: first.slug, title: meta.title, kind: 'asmr', dir, slug });
}

const summary = [];
// --gpu is Vulkan on Linux, Metal on a Mac. --channel=chrome drives the
// installed Google Chrome where Playwright's own Chromium is not installed.
const GPU_ARGS = process.platform === 'darwin'
  ? ['--use-angle=metal', '--ignore-gpu-blocklist']
  : ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const launch = () => chromium.launch({
  channel: opt('channel', undefined),
  args: args.includes('--swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : args.includes('--gpu') ? GPU_ARGS : [],
});
let browser = await launch();
const pidFile = path.join(OUT, 'runner.pid');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(pidFile, String(process.pid));
try {
  // The week's ASMR is the arsenal; a theme name films the old mix of moments.
  if (MIX === 'week' || MIX === 'arsenal') await filmArsenal();
  else if (MIX) await filmAsmrMix(MIX);
  else for (const r of await recordingsToDo()) {
    try {
      const res = await fetchRetry(`${API}${r.recordingUrl}`);
      if (!res.ok) throw new Error(`recording ${res.status}`);
      const rec = R.parseRecording(await res.text());
      // A failed download parses as an empty round: never judge Shorts by it
      // (2026-11-03, a run took down three good Shorts on one).
      if (!rec.kills?.length) throw new Error('the recording has no kills: not read whole');
      const models = await modelsOf(r.mod);
      const cands = P.shortCandidates(rec, { models, slug: r.slug });
      // --fresh films every pick whatever is live (a re-record of them all,
      // the owner, 2026-11-04: "while it's young we can afford to re-record");
      // the kills turned down by hand still stay out.
      const keys = FRESH ? new Set()
        : await json(`${TO}/stats/shorts/keys?recording=${r.slug}`).then(k => new Set(k.keys)).catch(() => new Set());
      for (const k of rejectedKeys(r.slug)) keys.add(k);
      // --kill=<t>:<victim> films that kill whatever was clipped before (a re-do).
      // It reaches every recording of the run; --kill=<slug>:<t>:<victim> only
      // that one (a re-film of 91 kills over 21 recordings matched two more
      // in recordings they were not for, 2026-11-05).
      // --max is a recording's single kills in all, the live and the turned
      // down among them: the nightly once topped every recording up by three
      // a night (a compilation's key has a victim below 0).
      const singlesTaken = [...keys].filter(k => Number(k.split(':').pop()) >= 0).length;
      const kindsWanted = many('kinds').flatMap(k => k.split(','));
      const only = LIVE
        ? LIVE.get(r.slug).filter(s => !kindsWanted.length || kindsWanted.includes(s.kind)).map(s => [s.killTime, s.victimPid])
        : many('kill').map(k => k.split(':')).filter(a => a.length < 3 || a[0] === r.slug).map(a => a.slice(-2).map(Number));
      // --kinds=own-goal,... films only those kinds (adding one kind to
      // recordings already clipped).
      const kinds = many('kinds').flatMap(k => k.split(','));
      // Tank busters only when asked for by name: their camera does not yet
      // frame a hull in a town (2026-11-09, Arnhem: the lens on the hull, then
      // in the fire), so the nightly leaves them out.
      const pool = kinds.length ? cands.filter(c => kinds.includes(c.kind)) : cands.filter(c => c.kind !== 'tank-buster');
      const picks = LIVE || only.length
        ? cands.filter(c => only.some(([t, v]) => Math.abs(c.t - t) < 0.05 && c.victim === v))
        : P.pickShorts(pool, { max: Math.max(0, MAX - singlesTaken), taken: keys });
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
        // The round's Battlefield ASMR, only when asked (--kinds=asmr): the
        // owner wants one ASMR a week (2026-11-04), the week's mix
        // (--asmr-mix=week), not one a round.
        if (kinds.includes('asmr')) {
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
            // --player=<name> films only that player's (a test of one).
            if (opt('player', null) !== null && reel.playerName !== opt('player', null)) continue;
            // His streak or burst is one Short a round whichever kills it
            // shows: a key with his reel's victim is it (keys once followed
            // the first kill shown, now the streak's first kill).
            if (keys.has(reel.key) || [...keys].some(k => k.endsWith(`:${reel.victim}`))) continue;
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
      if (!LIVE && !only.length && !kinds.length && star && !picks.some(p => p.killerName === star || p.playerName === star)) {
        const own = P.featuredOf(rec, { name: star, cands, models, slug: r.slug });
        if (own && !keys.has(own.key) && !picks.some(p => p.key === own.key)) {
          picks.push(own);
          log(`  featuring ${star}, who recorded it: ${own.kind} at ${own.t.toFixed(1)}`);
        }
      }
      // --kill=<t>:<victim> reaches his featured shot too (not a candidate
      // when it is his longest shot only).
      if (only.length && star) {
        const own = P.featuredOf(rec, { name: star, cands, models, slug: r.slug });
        if (own && only.some(([t, v]) => Math.abs(own.t - t) < 0.05 && own.victim === v) && !picks.some(p => p.key === own.key)) picks.push(own);
      }
      // Two players who uploaded the same round see the same moments: a
      // moment another recording of the round already has (live, or filmed
      // earlier in this run) is not filmed again (2026-11-07, XStefX's streak
      // on Soletschnogorsk filmed from Chief's half and from Jan's).
      if (!LIVE && !only.length) {
        const twins = await roundTwinMoments(r);
        const ownOffset = r.round?.find(x => x.slug === r.slug)?.roundOffsetSeconds ?? 0;
        for (let i = picks.length - 1; i >= 0; i--) {
          const mine = momentOf(picks[i], ownOffset);
          const twin = twins.find(m => sameMoment(m, mine));
          if (twin) {
            log(`  ${picks[i].kind} at ${picks[i].t.toFixed(1)} is already a Short of ${twin.slug}, the same round`);
            picks.splice(i, 1);
          }
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
          filmedMoments.push({ ...momentOf(c, r.round?.find(x => x.slug === r.slug)?.roundOffsetSeconds ?? 0), slug: r.slug });
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
