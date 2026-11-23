#!/usr/bin/env node
// Cover job for shared round recordings: a recording nobody gave a cover has
// none on the feed or in its Discord link preview. This opens each coverless
// recording on the live replay page, plays to a moment worth showing, grabs a
// frame the way the page's own cover does (the F key, `frameOf` in
// tools/bf1942-models/viewer/replay-social.js) and keeps it, or uploads it.
//
//   node scripts/recording-covers.mjs [--recordings=10] [--recording=<slug>]...
//        [--out=~/.cache/bfstats-covers] [--upload] [--channel=chrome] [--gpu|--swiftshader]
//        [--play=https://play.bfstats.io] [--api=https://play.bfstats.io]
//
// Without --upload it writes <out>/<slug>.jpg and stops. With it, each JPEG is
// PUT to ${api}/stats/recordings/<slug>/filmed-cover with the key from
// SHORTS_UPLOAD_KEY: 200 is kept, 409 (it has a cover by now) is logged and
// passed over, 401 (a bad key) stops the run.
//
// The page is the live play site, left to play in real time: the animation loop
// and the clock are the page's own. The moment is a kill by the player who made
// the recording near the middle of the round (they are the followed player), a
// second or two after the seek so the frame is at about the kill; failing that
// any kill near the middle with its killer followed; failing that the middle.
// A frame that is nearly black, one flat colour or a smooth sky is thrown away and the next
// moment tried.
//
// A recording that gave no cover (its level is not in the viewer, the page
// never loaded, every moment was a bad frame) leaves <out>/<slug>.none and is
// left alone for a week: the nightly would otherwise spend minutes on it every
// night. --recording=<slug> films it whatever the mark says.
//
// One headless browser at a time, one page at a time; every wait is bounded.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(REPO, 'ui/package.json'))('playwright');

const args = process.argv.slice(2);
const opt = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const API = opt('api', 'https://play.bfstats.io');
const PLAY = opt('play', 'https://play.bfstats.io');
const OUT = opt('out', path.join(os.homedir(), '.cache/bfstats-covers'));
const NEWEST = Number(opt('recordings', 10));
/** --recording=<slug>, repeatable: those recordings, cover or not. */
const ONE = args.filter(a => a.startsWith('--recording=')).map(a => a.slice(12));
const UPLOAD = args.includes('--upload');
const KEY = process.env.SHORTS_UPLOAD_KEY ?? '';

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

/** A page that never says it is ready is given this long (a big mod level loads for a minute or more). */
const LOAD_TIMEOUT = 5 * 60 * 1000;
/** One step in the page (a seek, a frame) may take this long. */
const STEP_TIMEOUT = 45 * 1000;
/** The hulls and bodies keep arriving for a while after the status line. */
const SETTLE_MS = 8000;
/** The replay plays this long (real time) after a seek, so the frame is at about the kill. */
const LEAD_S = 1.5;
/** Moments tried for one recording before it is given up. */
const TRIES = 4;
/** Moments closer together than this are the same fight. */
const APART_S = 20;
/** A frame whose luminance has less spread than this is one flat colour; one darker or lighter is blank. */
const MIN_SPREAD = 14;
const MIN_MEAN = 28;
const MAX_MEAN = 232;
/** Mean step between neighbouring pixels below which the frame is a smooth gradient (open sky, fog). */
const MIN_DETAIL = 2.5;
/** A recording that gave no cover is not tried again for this long. */
const RETRY_AFTER_MS = 7 * 24 * 3600 * 1000;

const noneMark = slug => path.join(OUT, `${slug}.none`);
/** Whether `slug` gave no cover within the last week. */
function givenUp(slug) {
  try {
    return Date.now() - fs.statSync(noneMark(slug)).mtimeMs < RETRY_AFTER_MS;
  } catch {
    return false;
  }
}
/** Marks `slug` as having given no cover, and why. */
function giveUp(slug, why) {
  try {
    fs.writeFileSync(noneMark(slug), `${new Date().toISOString()} ${why}\n`);
  } catch (e) {
    log('  could not write', noneMark(slug), e.message);
  }
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took over ${Math.round(ms / 1000)} s`)), ms);
  })]).finally(() => clearTimeout(timer));
}

async function fetchRetry(url, init) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(60000), ...init });
    } catch (e) {
      if (i >= 3) throw e;
      log(`  ${e.message} (${url.split('?')[0]}), again in ${5 * 2 ** i} s`);
      await new Promise(r => setTimeout(r, 5000 * 2 ** i));
    }
  }
}

/**
 * The coverless recordings, newest first. A feed item that is a round card
 * wraps several recordings (`round`, the first is the card's own): the card has
 * a cover when `roundCard.thumbnailUrl` does, and then none of its recordings
 * is coverless; otherwise its first recording is filmed, which is what the
 * card shows.
 */
async function coverless() {
  const wanted = ONE.length ? ONE : null;
  const found = [];
  const seen = new Set();
  for (let page = 1, pages = 1; page <= pages; page++) {
    const res = await fetchRetry(`${API}/stats/recordings?page=${page}&pageSize=24`);
    if (!res.ok) throw new Error(`the feed answered ${res.status}`);
    const feed = await res.json();
    pages = feed.totalPages ?? 1;
    for (const item of feed.items ?? []) {
      const rows = item.round?.length ? item.round : [item];
      const cardCover = item.roundCard ? item.roundCard.thumbnailUrl : item.thumbnailUrl;
      for (const row of rows) {
        const r = { ...item, ...row, mod: item.mod, level: item.level };
        if (seen.has(r.slug)) continue;
        seen.add(r.slug);
        if (wanted) {
          if (wanted.includes(r.slug)) found.push(r);
        } else if (!cardCover && row === rows[0] && !r.thumbnailUrl && !givenUp(r.slug)) found.push(r);
      }
    }
    if (wanted ? found.length >= wanted.length : found.length >= NEWEST) break;
  }
  if (wanted) return found;
  return found.slice(0, NEWEST);
}

function playUrl(r) {
  const q = new URLSearchParams({ mod: r.mod, map: r.level, replay: r.recordingUrl });
  return `${PLAY}/map.html?${q.toString().replace(/%2F/g, '/')}&mute`;
}

/** Opens the recording; resolves to the page, or throws with the reason the level cannot play. */
async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => log('  pageerror', e.message.slice(0, 200)));
  const evaluate = page.evaluate.bind(page);
  page.evaluate = (fn, arg) => withTimeout(evaluate(fn, arg), STEP_TIMEOUT, 'a page step');
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    // Ready when the replay has its status line; refused when the page says the
    // level is not in the viewer (map.html, replay-open.js `unplayableReason`).
    const state = await page.waitForFunction(() => {
      if (window.replay?.statusLine) return 'ready';
      const text = document.body?.innerText ?? '';
      if (/not in the viewer yet|has no maps in the viewer/i.test(text)) return text.match(/[^\n]*(not in the viewer yet|has no maps in the viewer)[^\n]*/i)[0];
      return false;
    }, null, { timeout: LOAD_TIMEOUT, polling: 1000 });
    const said = await state.jsonValue();
    if (said !== 'ready') throw new Error(`refused: ${said.trim().slice(0, 120)}`);
    await page.waitForTimeout(SETTLE_MS);
    log('  loaded in', Math.round((Date.now() - t0) / 1000), 's');
    return page;
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
}

/**
 * The moments worth a cover, best first: [{ t, pid, why }], `t` the seek time
 * and `pid` who to follow. Kills by the player who recorded the round, nearest
 * the middle first, then any kill (its killer followed), then the middle.
 */
function momentsOf(info) {
  const mid = info.duration / 2;
  const byMiddle = (a, b) => Math.abs(a.t - mid) - Math.abs(b.t - mid);
  const usable = k => k.kind === 'kill' && k.killer !== null && k.killer !== undefined && k.t > LEAD_S + 5 && k.t < info.duration - 5;
  const own = info.kills.filter(k => usable(k) && info.recordingPids.includes(k.killer)).sort(byMiddle);
  const other = info.kills.filter(k => usable(k) && !info.recordingPids.includes(k.killer)).sort(byMiddle);
  const out = [];
  const take = (list, why) => {
    for (const k of list) {
      const t = Math.max(0, k.t - LEAD_S);
      if (out.some(m => Math.abs(m.t - t) < APART_S)) continue;
      out.push({ t, pid: k.killer, why: `${why} at ${k.t.toFixed(0)} s` });
    }
  };
  take(own, 'a kill by the recorder');
  take(other, 'a kill by another player');
  if (!out.length || out.length < TRIES) out.push({ t: mid, pid: null, why: `the middle of the round, ${mid.toFixed(0)} s` });
  return out;
}

/**
 * Seeks the replay to `moment`, lets it play LEAD_S, then takes the next
 * rendered frame as the page's own cover does: 16:9 crop, 640x360, JPEG at
 * 0.86, read in `afterRender` because a WebGL canvas can only be read right
 * after a render. Resolves to { jpeg (base64), mean, spread, t }.
 */
async function film(page, moment) {
  return page.evaluate(async ({ moment, lead }) => {
    const replay = window.replay;
    if (moment.pid !== null) replay.follow(moment.pid);
    // Outside the followed player's head so they are in frame: the first-person
    // default looked at a wall or a pillar on the first test. The chase is the
    // game's own rear view; the orbit where the seat has no chase.
    const cam = replay.camera;
    if (cam.mode !== 'chase' && !cam.cameraKey(2)?.changed && cam.mode !== 'orbit') cam.setMode('orbit');
    replay.seek(moment.t);
    replay.playing = true;
    const start = performance.now();
    await new Promise(r => setTimeout(r, lead * 1000));
    // A heavy page may have played less than asked: wait on the replay's clock.
    while (replay.time < moment.t + lead * 0.8 && performance.now() - start < 15000) await new Promise(r => setTimeout(r, 100));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no frame rendered')), 15000);
      const after = replay.afterRender.bind(replay);
      replay.afterRender = canvas => {
        replay.afterRender = after;
        after(canvas);
        clearTimeout(timer);
        const W = 640;
        const H = 360;
        const out = document.createElement('canvas');
        out.width = W;
        out.height = H;
        const ctx = out.getContext('2d', { willReadFrequently: true });
        const scale = Math.max(W / canvas.width, H / canvas.height);
        const sw = W / scale;
        const sh = H / scale;
        ctx.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, W, H);
        const px = ctx.getImageData(0, 0, W, H).data;
        let sum = 0;
        let sq = 0;
        let edges = 0;
        let prev = 0;
        const n = px.length / 4;
        for (let i = 0; i < px.length; i += 4) {
          const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          sum += y;
          sq += y * y;
          // Detail: how far a pixel is from its left neighbour. A sky or a fog
          // bank is smooth, a scene of ground and men is not.
          if (i % (W * 4) !== 0) edges += Math.abs(y - prev);
          prev = y;
        }
        const mean = sum / n;
        const spread = Math.sqrt(Math.max(0, sq / n - mean * mean));
        out.toBlob(blob => {
          const fr = new FileReader();
          fr.onload = () => resolve({ jpeg: String(fr.result).split(',')[1], mean, spread, detail: edges / n, t: replay.time });
          fr.onerror = () => reject(new Error('could not read the frame'));
          fr.readAsDataURL(blob);
        }, 'image/jpeg', 0.86);
      };
    });
  }, { moment, lead: LEAD_S });
}

const badFrame = f => (f.mean < MIN_MEAN ? 'nearly black' : f.mean > MAX_MEAN ? 'nearly white'
  : f.spread < MIN_SPREAD ? 'one flat colour' : f.detail < MIN_DETAIL ? 'a smooth gradient with no detail' : '');

/** Uploads a cover. Resolves to 'sent', 'has-cover'; throws on a bad key or other failure. */
async function upload(slug, jpeg) {
  const res = await fetchRetry(`${API}/stats/recordings/${slug}/filmed-cover`, {
    method: 'PUT', headers: { 'X-Shorts-Key': KEY, 'Content-Type': 'image/jpeg' }, body: jpeg,
  });
  if (res.status === 200) return 'sent';
  if (res.status === 409) return 'has-cover';
  if (res.status === 401) throw Object.assign(new Error('the upload key was refused (401)'), { fatal: true });
  throw new Error(`the upload answered ${res.status}`);
}

if (UPLOAD && !KEY) {
  console.error('--upload needs SHORTS_UPLOAD_KEY');
  process.exit(1);
}

const GPU_ARGS = process.platform === 'darwin'
  ? ['--use-angle=metal', '--ignore-gpu-blocklist']
  : ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({
  channel: opt('channel', undefined),
  args: args.includes('--swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : args.includes('--gpu') ? GPU_ARGS : [],
});

let ran = 0;
let asked = 0;
let stop = false;
try {
  fs.mkdirSync(OUT, { recursive: true });
  const todo = await coverless();
  asked = todo.length;
  log(`${todo.length} coverless recording(s)`);
  for (const r of todo) {
    if (stop) break;
    const t0 = Date.now();
    const secs = () => `${Math.round((Date.now() - t0) / 1000)} s`;
    let page;
    try {
      page = await openPage(browser, playUrl(r));
      const info = await page.evaluate(() => {
        const p = window.replay;
        return { duration: p.rec.duration, kills: p.kills.map(k => ({ t: k.t, kind: k.kind, killer: k.killer, victim: k.victim })),
                 recordingPids: p.recordingPids ?? [] };
      });
      const moments = momentsOf(info).slice(0, TRIES);
      let kept = null;
      const notes = [];
      for (const moment of moments) {
        let f;
        try {
          f = await film(page, moment);
        } catch (e) {
          notes.push(`${moment.why}: ${e.message}`);
          continue;
        }
        const bad = badFrame(f);
        const stats = `mean ${f.mean.toFixed(0)}, spread ${f.spread.toFixed(0)}, detail ${f.detail.toFixed(1)}`;
        if (bad) {
          notes.push(`${moment.why}: ${bad} (${stats})`);
          continue;
        }
        kept = { moment, f, stats };
        break;
      }
      ran++;
      if (!kept) {
        log(r.slug, r.level, 'no cover:', notes.join('; '));
        giveUp(r.slug, notes.join('; '));
        continue;
      }
      const bytes = Buffer.from(kept.f.jpeg, 'base64');
      const file = path.join(OUT, `${r.slug}.jpg`);
      fs.writeFileSync(file, bytes);
      let sent = '';
      if (UPLOAD) {
        const outcome = await upload(r.slug, bytes);
        sent = outcome === 'sent' ? ', uploaded' : ', already has a cover (409), not uploaded';
      }
      const skipped = notes.length ? ` after ${notes.length} rejected (${notes.join('; ')})` : '';
      log(r.slug, r.level, `${kept.moment.why} (${kept.stats}) -> ${file}${sent}${skipped} in ${secs()}`);
    } catch (e) {
      if (e.fatal) {
        log(r.slug, r.level, e.message, '- stopping');
        stop = true;
      } else if (/refused|not in the viewer/.test(e.message)) {
        log(r.slug, r.level, 'skipped:', e.message);
        giveUp(r.slug, e.message);
      } else {
        log(r.slug, r.level, 'failed:', e.message.slice(0, 200), `in ${secs()}`);
        // The upload failing is the API's trouble, not the recording's: tried again tomorrow.
        if (!/upload/.test(e.message)) giveUp(r.slug, e.message.slice(0, 200));
      }
    } finally {
      await page?.close().catch(() => {});
    }
  }
} catch (e) {
  console.error('recording-covers:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
// Nothing coverless is a quiet night, not a failure.
if (asked > 0 && ran === 0 && !process.exitCode) {
  log('nothing could run');
  process.exitCode = 1;
}
