#!/usr/bin/env node
// Recorded-against-drawn audit: play a recording forward headless and count,
// for every soldier on foot, how many of the states the file records the page
// actually drew.
//
//   flock /tmp/claude-1000/chromium.lock \
//     node audit_replay_states.mjs [--recording <slug|url>]... [--recent N] \
//          [--file <local.ndjson> --replay-path <path the page loads>] \
//          [--base https://play.bfstats.io | --serve <viewer dir>] [--from S --to S] \
//          [--windows N --window S] [--speed 1] [--json out.json] \
//          [--min-share 0.8] [--min-episodes 5] [--headed]
//
// Why. Of the fifteen replay nitpicks fixed 2026-10-25..11-02, six were states
// the file carried and the page never drew (a kit pickup, the recorded lower
// state, 61 of 70 survived hit states, 49 lying draws), each found by a count
// made after a user's report (replay-forensics skill, section 5). This makes
// that count before the user does.
//
// What is counted, per recording. A soldier is judged only on frames where the
// page has his body to draw (`ReplaySoldiers.drawn`), alive and on foot.
//   body.drawn   frames whose body is loaded and visible; a stretch of 0.5 s or
//                more without one is a miss. The first `--settle` seconds after
//                each seek are left out here and timed on their own (`seek`).
//   lower        each run of one recorded lower state (`Lb_*`) is an episode;
//                drawn when at least half its frames draw the same gait family
//                (`remote-gait.js` recordedGait) as the state. A resting state a
//                bot at AI LOD 1 or 2 holds is excused (`lowerHeldByLod`,
//                AI-136): the page draws his speed there on purpose.
//   upper        each run of a recorded torso action (fire, alt fire, reload,
//                bolt, hit flinch, weapon draw, jump) is an episode; drawn when
//                any frame from its start to 0.3 s after its end draws that
//                action.
//   kit          frames whose drawn kit is the kit the file has him in then
//                (`kitAt`, with the kits `inferKits` gives soldiers alive
//                before the recording began); a stretch of 0.3 s or more wrong
//                is a miss.
//   seek         after each seek, how long each soldier waited for his body.
//
// Output: a table on stderr, JSON with every miss on --json. Exit 1 when a
// lower state or upper action with --min-episodes or more episodes was drawn
// under --min-share of the time, a kit was wrong for over a second, or a body
// went undrawn for over two; 2 when the run could not be staged.
//
// It drives the page at --base as served (the live site by default).
// `--serve <viewer dir>` audits local viewer code instead: the audit serves
// that directory itself on the first free port of 5310-5359 (never 5273) and
// hands the page the recording from `/__audit/`, fetched from the feed for a
// --recording or read from --file (with --mod and --level). A worktree's
// viewer needs its assets linked first (link_viewer_assets.sh). An asset the
// local tree lacks comes from --asset-fallback (the live site; `none` turns it
// off); code (.js, .html) never does.
// One headless Chromium at a time: the caller wraps the run in flock.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// --------------------------------------------------------------- vocabulary
//
// Pure: a clip or state name in, what it is out. The page draws a gait by its
// family's clip (`run.lower`, `crouchwalk.lower`), a still stance by its pose
// (`stand`, `crouch`, `lie`), and a recorded state by its own name
// (`Lb_RunJump`, `Ub_Fire`, `Ub_StandRaiseWeapon`): the drawn names carry no
// weapon, the recorded ones do.

/** The gait family a DRAWN lower clip is, or null. `gaitOf` is remote-gait.js
 *  recordedGait, for the clips the page plays by their recorded name. */
export function drawnFamily(name, gaitOf) {
  if (typeof name !== 'string' || !name) return null;
  const base = name.replace(/\.(lower|upper)$/i, '').toLowerCase();
  if (base === 'lie') return 'prone';
  if (['stand', 'crouch', 'prone', 'walk', 'run', 'crouchwalk', 'crawl'].includes(base)) return base;
  return gaitOf(name)?.family ?? null;
}

const UPPER_KINDS = [
  // Longest first: `Ub_FireEndMp40` is the fire's end, not `Ub_Fire` of `EndMp40`.
  [/^ub_(lie)?fireend/i, 'fire'],
  [/^ub_(lie)?altfire/i, 'altfire'],
  [/^ub_(lie)?fire/i, 'fire'],
  [/^ub_(stand|lie)reload/i, 'reload'],
  [/^ub_(stand|lie)boltoperate/i, 'bolt'],
  [/^ub_hit(chest|back)(stand|crouch)$|^ub_hitlie$/i, 'hit'],
  [/^ub_(stand|crouch|lie)(reset)?raiseweapon/i, 'raise'],
  [/^ub_(runjump|standjump)/i, 'jump'],
];

/** The torso action an upper state or clip name is, recorded or drawn, or
 *  null for a gait's upper half or a held pose. */
export function upperKind(name) {
  if (typeof name !== 'string' || !name) return null;
  for (const [re, kind] of UPPER_KINDS) if (re.test(name)) return kind;
  return null;
}

// ---------------------------------------------------------------- the count
//
// Pure: the recording (as parseRecording reads it), the viewer's own helpers,
// and the frames the page drew, in; every check's tally and misses out.
//
// A frame is `{ t, pid, nid, drawn, lower, upper, kit, settle, w }`: `drawn`
// whether his body was loaded and visible, `settle` true inside the first
// seconds after a seek, `w` the window (a seek starts a new one).

export const LEAD = 0.15;           // a gait cross-fades in before it counts
export const UPPER_GRACE = 0.3;     // a one-shot the page enters on its event
export const UNDRAWN_MISS = 0.5;
export const KIT_MISS = 0.3;

/** Contiguous runs of `key(frame)` per soldier life and window. Each run is
 *  `{ nid, pid, w, value, t0, t1, frames }`; a null key ends a run. */
export function runsOf(frames, key) {
  const open = new Map();
  const out = [];
  const close = id => { const r = open.get(id); if (r) { out.push(r); open.delete(id); } };
  for (const f of frames) {
    const id = `${f.w}|${f.nid}`;
    const v = key(f);
    const r = open.get(id);
    if (r && v !== null && r.value === v) { r.t1 = f.t; r.frames.push(f); continue; }
    close(id);
    if (v !== null) open.set(id, { nid: f.nid, pid: f.pid, w: f.w, value: v, t0: f.t, t1: f.t, frames: [f] });
  }
  for (const id of [...open.keys()]) close(id);
  return out.sort((a, b) => a.t0 - b.t0 || a.nid - b.nid);
}

const mostOf = list => {
  const c = new Map();
  for (const x of list) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/**
 * Every check over `frames`. `h` is the viewer's own reader:
 * `{ bodyAt, kitAt, lifeAt, nameAt, recordedGait, lowerHeldByLod }`.
 * Returns `{ tally: [{ check, key, episodes, drawn, excused, share }],
 * misses: [...], seek: {...} }`.
 */
export function auditFrames(rec, frames, h, opts = {}) {
  const minShare = opts.minShare ?? 0.8;
  const minEpisodes = opts.minEpisodes ?? 5;
  const name = (pid, t) => h.nameAt(rec, pid, t);
  const misses = [];
  const tally = new Map();
  const count = (check, key, field) => {
    const k = `${check}|${key}`;
    const row = tally.get(k) ?? { check, key, episodes: 0, drawn: 0, excused: 0 };
    row[field] += 1;
    tally.set(k, row);
  };
  const judged = frames.filter(f => !f.settle);
  const shown = judged.filter(f => f.drawn);

  // Recorded body per frame, read once.
  for (const f of judged) f.rec = h.bodyAt(rec, f.nid, f.t);

  // body.drawn: stretches with nothing drawn.
  for (const run of runsOf(judged, f => (f.drawn ? null : 'undrawn'))) {
    const span = run.t1 - run.t0;
    count('body.drawn', 'stretch', span >= UNDRAWN_MISS ? 'episodes' : 'excused');
    if (span >= UNDRAWN_MISS) {
      misses.push({ check: 'body.drawn', pid: run.pid, nid: run.nid, name: name(run.pid, run.t0),
        t0: +run.t0.toFixed(2), t1: +run.t1.toFixed(2), recorded: 'body in the file', drawn: 'none' });
    }
  }

  // lower: each recorded lower state. A bot's AI LOD moves while he holds one
  // state, so the excuse is read per frame and splits the run.
  for (const run of runsOf(shown, f => {
    const lower = f.rec?.lower ?? null;
    if (!lower) return null;
    return h.lowerHeldByLod(rec, f.pid, lower, f.t) ? `${lower}|lod` : lower;
  })) {
    if (run.value.endsWith('|lod')) { count('lower', run.value.slice(0, -4), 'excused'); continue; }
    const want = h.recordedGait(run.value)?.family ?? null;
    if (!want) continue;
    count('lower', run.value, 'episodes');
    let judge = run.frames.filter(f => f.t >= run.t0 + LEAD);
    if (!judge.length) judge = run.frames;
    const got = judge.map(f => drawnFamily(f.lower, h.recordedGait));
    const share = got.filter(g => g === want).length / got.length;
    if (share >= 0.5) count('lower', run.value, 'drawn');
    else {
      const families = new Map();
      for (const g of got) families.set(g, (families.get(g) ?? 0) + 1);
      misses.push({ check: 'lower', pid: run.pid, nid: run.nid, name: name(run.pid, run.t0),
        t0: +run.t0.toFixed(2), t1: +run.t1.toFixed(2), recorded: `${run.value} (${want})`,
        drawn: [...families].sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([g, n]) => `${g} ${Math.round((100 * n) / got.length)}%`).join(', ') });
    }
  }

  // upper: each recorded torso action.
  const byNid = new Map();
  for (const f of shown) {
    const list = byNid.get(f.nid) ?? [];
    list.push(f);
    byNid.set(f.nid, list);
  }
  for (const run of runsOf(shown, f => upperKind(f.rec?.upper))) {
    const kind = run.value;
    count('upper', kind, 'episodes');
    const span = (byNid.get(run.nid) ?? []).filter(f => f.w === run.w && f.t >= run.t0 && f.t <= run.t1 + UPPER_GRACE);
    if (span.some(f => upperKind(f.upper) === kind)) count('upper', kind, 'drawn');
    else {
      misses.push({ check: 'upper', pid: run.pid, nid: run.nid, name: name(run.pid, run.t0),
        t0: +run.t0.toFixed(2), t1: +run.t1.toFixed(2), recorded: run.frames[0].rec.upper,
        drawn: mostOf(span.map(f => f.upper)), holding: mostOf(span.map(f => f.weapon ?? null)) });
    }
  }

  // kit: the drawn kit against the kit the file has him in.
  const kitWant = f => h.kitAt(h.lifeAt(rec, f.nid, f.t), f.t);
  for (const run of runsOf(shown, f => {
    const want = kitWant(f);
    return want && f.kit && want !== f.kit ? `${want}|${f.kit}` : null;
  })) {
    const span = run.t1 - run.t0;
    if (span < KIT_MISS) continue;
    const [want, drew] = run.value.split('|');
    count('kit', want, 'episodes');
    misses.push({ check: 'kit', pid: run.pid, nid: run.nid, name: name(run.pid, run.t0),
      t0: +run.t0.toFixed(2), t1: +run.t1.toFixed(2), recorded: want, drawn: drew });
  }
  const kitFrames = shown.filter(f => f.kit && kitWant(f));
  const kitRight = kitFrames.filter(f => kitWant(f) === f.kit).length;

  // seek: from each seek, how long each soldier waited for a body.
  const waits = [];
  const firstDrawn = new Map();
  const seenIn = new Map();
  for (const f of frames) {
    const id = `${f.w}|${f.pid}`;
    if (!seenIn.has(id)) seenIn.set(id, f.t);
    if (f.drawn && !firstDrawn.has(id)) firstDrawn.set(id, f.t);
  }
  for (const [id, t0] of seenIn) {
    const t1 = firstDrawn.get(id);
    if (t1 !== undefined) waits.push(t1 - t0);
  }
  waits.sort((a, b) => a - b);
  const q = p => (waits.length ? +waits[Math.min(waits.length - 1, Math.floor(p * waits.length))].toFixed(2) : null);

  const rows = [...tally.values()].map(r => ({
    ...r, share: r.episodes ? +(r.check === 'upper' || r.check === 'lower' ? r.drawn / r.episodes : 0).toFixed(3) : null,
  })).sort((a, b) => a.check.localeCompare(b.check) || b.episodes - a.episodes);

  const failures = [];
  for (const r of rows) {
    if ((r.check === 'lower' || r.check === 'upper') && r.episodes >= minEpisodes && r.share < minShare) {
      failures.push(`${r.check} ${r.key}: ${r.drawn} of ${r.episodes} drawn`);
    }
  }
  const kitLong = misses.filter(m => m.check === 'kit' && m.t1 - m.t0 > 1);
  const bodyLong = misses.filter(m => m.check === 'body.drawn' && m.t1 - m.t0 > 2);
  const first = list => list.reduce((a, b) => (b.t1 - b.t0 > a.t1 - a.t0 ? b : a));
  if (kitLong.length) {
    const m = first(kitLong);
    failures.push(`kit wrong for over 1 s ${kitLong.length} times; longest ${m.recorded} drawn as ${m.drawn}`
      + ` for ${(m.t1 - m.t0).toFixed(1)} s (${m.name} at ${m.t0})`);
  }
  if (bodyLong.length) {
    const m = first(bodyLong);
    failures.push(`no body for over 2 s ${bodyLong.length} times; longest ${(m.t1 - m.t0).toFixed(1)} s`
      + ` (${m.name} at ${m.t0})`);
  }
  return {
    frames: { judged: judged.length, drawn: shown.length,
      drawnShare: judged.length ? +(shown.length / judged.length).toFixed(3) : null,
      kitShare: kitFrames.length ? +(kitRight / kitFrames.length).toFixed(3) : null },
    seek: { soldiers: waits.length, p50: q(0.5), p90: q(0.9), max: waits.length ? +waits.at(-1).toFixed(2) : null },
    tally: rows,
    misses: misses.sort((a, b) => a.t0 - b.t0),
    failures,
  };
}

/** The windows to play: `--from/--to` as given, else the whole recording when
 *  it is short, else `n` windows of `len` seconds spread over it. */
export function windowsFor(duration, { from = null, to = null, n = 4, len = 60 } = {}) {
  if (from !== null || to !== null) return [[from ?? 0, Math.min(to ?? duration, duration)]];
  if (duration <= n * len) return [[0, duration]];
  const step = duration / n;
  return Array.from({ length: n }, (_, i) => {
    const a = Math.max(0, Math.min(duration - len, i * step + (step - len) / 2));
    return [+a.toFixed(1), +(a + len).toFixed(1)];
  });
}

// ---------------------------------------------------------------- the run
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const args = n => process.argv.flatMap((a, i) => (a === `--${n}` ? [process.argv[i + 1]] : []));
const flag = n => process.argv.includes(`--${n}`);
const log = (...a) => console.error('[replay-states]', ...a);

// Runs in the page: play each window forward and keep, every frame, what each
// soldier the page has a body for is drawn doing.
async function sampleInPage({ windows, speed, settle, budgetMs }) {
  const r = window.replay;
  const s = r.soldiers;
  if (s?.warming) await Promise.race([s.warming, new Promise(res => setTimeout(res, 15000))]);
  const frames = [];
  const t0 = performance.now();
  for (let w = 0; w < windows.length; w++) {
    const [a, b] = windows[w];
    r.playing = false;
    r.seek(a);
    r.speed = speed;
    r.playing = true;
    const seekWall = performance.now();
    await new Promise(res => {
      const tick = () => {
        const live = new Map((s.bodies?.debug?.().live ?? []).map(v => [v.id, v]));
        const settling = performance.now() - seekWall < settle * 1000;
        for (const actor of s.drawn) {
          if (actor.vehicle || actor.state.dead || actor.seat) continue;
          if (actor.state.soldier.held?.kind) continue;   // a blast or chute holds the recorded pair
          const v = live.get(actor.playerId);
          frames.push([+r.time.toFixed(3), actor.pid, actor.lifeNid, v?.rig && v.visible ? 1 : 0,
            v?.lower ?? null, v?.upper ?? null, v?.kit ?? null, settling ? 1 : 0, w, v?.weapon ?? null]);
        }
        const done = r.time >= b - 0.05 || !r.playing || performance.now() - t0 > budgetMs;
        if (done) res(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (performance.now() - t0 > budgetMs) break;
  }
  r.playing = false;
  // The kit table the page read, so node infers the same kits (`inferKits`).
  let loadouts = null;
  try { loadouts = JSON.parse(JSON.stringify(r.ctx.loadouts?.() ?? null)); } catch { loadouts = null; }
  return { frames, status: r.statusLine, duration: r.rec.duration, loadouts };
}

async function loadReader() {
  const { installModuleHooks, viewerDir } = await import(pathToFileURL(resolve(HERE, 'sim', 'env.mjs')).href);
  const viewer = viewerDir(resolve(HERE, 'viewer'));
  installModuleHooks(viewer);
  const recording = await import(pathToFileURL(resolve(viewer, 'replay-recording.js')).href);
  const gait = await import(pathToFileURL(resolve(viewer, 'remote-gait.js')).href);
  return {
    parseRecording: recording.parseRecording,
    h: {
      bodyAt: recording.bodyAt, kitAt: recording.kitAt, lifeAt: recording.lifeAt, nameAt: recording.nameAt,
      lowerHeldByLod: recording.lowerHeldByLod, recordedGait: gait.recordedGait,
    },
    inferKits: recording.inferKits,
  };
}

function printReport(slug, result) {
  const lines = [`${slug}: ${result.frames.judged} soldier-frames judged, body drawn ${pct(result.frames.drawnShare)},`
    + ` kit right ${pct(result.frames.kitShare)}, after a seek bodies waited p50 ${result.seek.p50} s / max ${result.seek.max} s`];
  for (const r of result.tally) {
    if (r.check !== 'lower' && r.check !== 'upper') continue;
    lines.push(`  ${r.check.padEnd(6)} ${r.key.padEnd(28)} ${String(r.drawn).padStart(5)} of ${String(r.episodes).padEnd(5)}`
      + ` drawn${r.excused ? `, ${r.excused} excused` : ''}`);
  }
  const by = new Map();
  for (const m of result.misses) by.set(m.check, (by.get(m.check) ?? 0) + 1);
  lines.push(`  misses: ${[...by].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  for (const f of result.failures) lines.push(`  FAIL ${f}`);
  console.error(lines.join('\n'));
}
const pct = v => (v === null || v === undefined ? '-' : `${(v * 100).toFixed(1)}%`);

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.wasm': 'application/wasm', '.ndjson': 'application/x-ndjson', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.ktx2': 'image/ktx2', '.dds': 'application/octet-stream',
};

/** A static server over `root` on the first free port of 5310-5359 (never
 *  5273, the owner's), with the recordings under audit at `/__audit/`. */
async function serveViewer(root, recordings, fallback = null) {
  const http = await import('node:http');
  const { createReadStream } = await import('node:fs');
  const { stat } = await import('node:fs/promises');
  const { extname, normalize, sep } = await import('node:path');
  const server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/__audit/')) {
      const body = recordings.get(p.slice('/__audit/'.length));
      if (body === undefined) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': TYPES['.ndjson'] }).end(body);
      return;
    }
    const file = normalize(resolve(root, `.${p.endsWith('/') ? `${p}index.html` : p}`));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': st.size });
      createReadStream(file).pipe(res);
    } catch {
      // An asset the local tree lacks (its glb store drifts from the live
      // volume) comes from `fallback`; code never does, so the page runs the
      // code under audit.
      if (fallback && !/\.(m?js|html)$/i.test(p)) {
        try {
          const r = await fetch(`${fallback}${p}`);
          if (r.ok) {
            const body = Buffer.from(await r.arrayBuffer());
            res.writeHead(200, { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream',
              'content-length': body.length }).end(body);
            fellBack.add(p);
            return;
          }
        } catch { /* 404 below */ }
      }
      res.writeHead(404).end();
    }
  });
  const fellBack = new Set();
  server.fellBack = fellBack;
  for (let port = 5310; port < 5360; port++) {
    const ok = await new Promise(res => {
      server.once('error', () => res(false));
      server.listen(port, '127.0.0.1', () => res(true));
    });
    if (ok) return { server, base: `http://127.0.0.1:${port}` };
  }
  throw new Error('no free port in 5310-5359');
}

async function main() {
  const SERVE = arg('serve', null) ? resolve(arg('serve')) : null;
  let BASE = arg('base', 'https://play.bfstats.io').replace(/\/$/, '');
  const API = arg('api', SERVE || BASE === 'https://play.bfstats.io' ? 'https://bfstats.io' : BASE).replace(/\/$/, '');
  const SPEED = Number(arg('speed', 1));
  const SETTLE = Number(arg('settle', 3));
  const BUDGET = Number(arg('max-minutes', 20)) * 60000;
  const OUT = arg('json', null);
  const opts = { minShare: Number(arg('min-share', 0.8)), minEpisodes: Number(arg('min-episodes', 5)) };
  const span = { from: arg('from', null) === null ? null : Number(arg('from')),
    to: arg('to', null) === null ? null : Number(arg('to')),
    n: Number(arg('windows', 4)), len: Number(arg('window', 60)) };

  const { parseRecordingArg } = await import(pathToFileURL(resolve(HERE, 'audit_replay_assets.mjs')).href);
  const wanted = [];
  if (arg('file', null)) {
    wanted.push({ slug: arg('file').replace(/^.*\//, '').replace(/\.ndjson$/, ''), file: resolve(arg('file')),
      replayPath: arg('replay-path', null), mod: arg('mod', null), level: arg('level', null) });
    if ((!wanted[0].replayPath && !SERVE) || !wanted[0].mod || !wanted[0].level) {
      log('--file needs --mod and --level, and --replay-path unless --serve'); process.exit(2);
    }
  }
  wanted.push(...args('recording').map(parseRecordingArg).filter(r => r.slug));
  const recent = Number(arg('recent', wanted.length ? 0 : 1));
  if (recent > 0) {
    const feed = await fetch(`${API}/stats/recordings?page=1&pageSize=${recent}&sort=recent`).then(r => r.json());
    for (const item of feed.items.slice(0, recent)) {
      if (!wanted.some(w => w.slug === item.slug)) wanted.push({ slug: item.slug, mod: item.mod, level: item.level });
    }
  }
  if (!wanted.length) { log('nothing to play: pass --recording, --recent or --file'); process.exit(2); }
  for (const w of wanted) {
    if (w.file) continue;
    w.replayPath = `/stats/recordings/${w.slug}.ndjson`;
    if (w.mod && w.level) continue;
    const detail = await fetch(`${API}/stats/recordings/${w.slug}`).then(r => (r.ok ? r.json() : null));
    if (!detail) { log(`the feed does not know ${w.slug}`); process.exit(2); }
    w.mod ??= detail.mod; w.level ??= detail.level;
  }

  const { parseRecording, h, inferKits } = await loadReader();
  const served = new Map();   // name -> recording text, for --serve
  let server = null;
  if (SERVE) {
    const fallback = arg('asset-fallback', 'https://play.bfstats.io');
    ({ server, base: BASE } = await serveViewer(SERVE, served, fallback === 'none' ? null : fallback));
    log('serving', SERVE, 'at', BASE, fallback === 'none' ? '' : `(assets it lacks from ${fallback})`);
  }
  const mainViewer = process.env.BF_VIEWER_MAIN ?? '/home/skandia/projects/skandia/bfstats/tools/bf1942-models/viewer';
  const playwright = [
    resolve(HERE, '../../ui/node_modules/playwright/index.mjs'),
    resolve(mainViewer, '../../../ui/node_modules/playwright/index.mjs'),
  ].find(existsSync);
  if (!playwright) { log('playwright not found: install ui/node_modules or set BF_VIEWER_MAIN'); process.exit(2); }
  const { chromium } = await import(pathToFileURL(playwright).href);
  const browser = await chromium.launch({
    headless: !flag('headed'),
    args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
  });

  const report = { base: BASE, recordings: [] };
  let failed = false;
  try {
    for (const w of wanted) {
      const text = w.file ? await readFile(w.file, 'utf8')
        : await fetch(`${API}${w.replayPath}`).then(r => { if (!r.ok) throw new Error(`${r.status} ${w.replayPath}`); return r.text(); });
      const rec = parseRecording(text);
      if (SERVE) {
        served.set(`${w.slug}.ndjson`, text);
        w.replayPath = `/__audit/${w.slug}.ndjson`;
      }
      const windows = windowsFor(rec.duration, span);
      const url = `${BASE}/map.html?mod=${encodeURIComponent(w.mod)}&map=${encodeURIComponent(w.level)}`
        + `&replay=${encodeURIComponent(w.replayPath)}&shots`;
      log('playing', w.slug, `${w.mod}/${w.level}`, windows.map(([a, b]) => `${a}-${b}`).join(' '));
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 300)));
      // A body that never loads proves nothing about states: keep what 404'd.
      const notFound = new Map();
      page.on('response', r => {
        if (r.status() < 400) return;
        const u = new URL(r.url());
        if (u.origin !== new URL(BASE).origin) return;
        notFound.set(decodeURIComponent(u.pathname), r.status());
      });
      let sampled;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
        await page.waitForFunction(() => window.replay?.statusLine && window.replay.soldiers, null, { timeout: 300000, polling: 500 });
        sampled = await page.evaluate(sampleInPage, { windows, speed: SPEED, settle: SETTLE, budgetMs: BUDGET });
      } catch (e) {
        log(w.slug, 'could not be played:', String(e.message).split('\n')[0]);
        await page.close().catch(() => {});
        failed = true;
        report.recordings.push({ slug: w.slug, error: String(e.message).split('\n')[0] });
        continue;
      }
      await page.close().catch(() => {});
      const frames = sampled.frames.map(([t, pid, nid, drawn, lower, upper, kit, settle, win, weapon]) =>
        ({ t, pid, nid, drawn: !!drawn, lower, upper, kit, settle: !!settle, w: win, weapon }));
      const states = (rec.animStates ?? []).filter(Boolean).length;
      if (!states) log(`${w.slug} has no "anim" state table: no recorded state can be read, so lower and upper judge nothing`);
      // The kits of soldiers alive before the recording began, as the page
      // infers them (replay.js load), so the kit check judges those lives too.
      const inferred = inferKits && sampled.loadouts ? inferKits(rec, sampled.loadouts) : 0;
      const result = auditFrames(rec, frames, h, opts);
      result.inferredKits = inferred;
      printReport(w.slug, result);
      if (server?.fellBack.size) log(`${server.fellBack.size} assets came from the fallback`);
      if (notFound.size) log(`${notFound.size} requests failed, e.g.`, [...notFound.keys()].slice(0, 5).join(' '));
      if (result.failures.length) failed = true;
      report.recordings.push({ slug: w.slug, mod: w.mod, level: w.level, url, windows, speed: SPEED,
        animStates: (rec.animStates ?? []).filter(Boolean).length,
        pageErrors, notFound: [...notFound].map(([path, status]) => ({ path, status })), ...result });
    }
  } finally {
    await browser.close();
    server?.close();
  }
  if (OUT) await writeFile(OUT, JSON.stringify(report, null, 1));
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { log(e.stack ?? e); process.exit(2); });
}
