// Re-encodes every live Short, roll and recap video that is full colour range
// to TV range (features/replay-shorts, "Colour range"), and swaps it in with
// PUT /stats/shorts/<slug>/video. Until 2026-11-18 the runners wrote full-range
// H.264 (ffprobe `yuvj420p`, range `pc`); Reddit's upload refused it with
// "unspecified error". The runners now encode TV range (scripts/video-range.mjs);
// a player's studio share is whatever their browser's MediaRecorder wrote, so the
// nightly job runs this after its uploads to put those right too.
//
//   SHORTS_UPLOAD_KEY=... node scripts/shorts-colour.mjs [--dry-run] [--only=<slug>,...] [--to=https://bfstats.io]
//
// Idempotent: a video already at TV range is left alone. Work files go to
// ~/.cache/bfstats-shorts/colour/ and are deleted once the swap is confirmed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tvFilter } from './video-range.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const TO = opt('to', 'https://bfstats.io');
const DRY = args.includes('--dry-run');
const ONLY = opt('only', '').split(',').filter(Boolean);
const KEY = process.env.SHORTS_UPLOAD_KEY ?? '';
if (!KEY && !DRY) {
  console.error('shorts-colour needs SHORTS_UPLOAD_KEY');
  process.exit(1);
}
const WORK = path.join(os.homedir(), '.cache', 'bfstats-shorts', 'colour');
const MiB = 1024 * 1024;
/** Under the edge's 100 MB a request: bigger goes in parts, as a roll's upload does. */
const ONE_REQUEST = 85 * MiB;
const PART = 80 * MiB;
/** The API's limits (api/Shorts/ShortsOptions.cs), a little under. */
const LANDSCAPE = new Set(['roll', 'recap']);
const limitOf = (copy, kind) =>
  copy === 'link' ? 47 * MiB : copy === 'hd' ? (LANDSCAPE.has(kind) ? 315 : 88) * MiB : (LANDSCAPE.has(kind) ? 990 : 88) * MiB;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchRetry(url, init = {}, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500 || i >= tries) return res;
    } catch (e) {
      if (i >= tries) throw e;
    }
    await sleep(2000 * i);
  }
}

async function liveShorts() {
  const seen = new Map();
  for (let page = 1; page < 100; page++) {
    const res = await fetchRetry(`${TO}/stats/shorts?days=3650&pageSize=100&page=${page}`);
    if (!res.ok) throw new Error(`list page ${page}: ${res.status}`);
    const body = await res.json();
    for (const s of body.items) seen.set(s.slug, s);
    if (body.items.length === 0 || page * body.pageSize >= body.total) break;
  }
  return [...seen.values()];
}

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=pix_fmt,color_range,bit_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(out);
  const s = j.streams?.[0] ?? {};
  return { pixFmt: s.pix_fmt ?? '', range: s.color_range ?? '', bitRate: Number(s.bit_rate) || 0, duration: Number(j.format?.duration) || 0 };
}
const isFull = p => p.range === 'pc' || p.pixFmt.startsWith('yuvj');

/** Probing a URL reads only the head of the file; retried, the edge answers 5xx under load. */
async function probeUrl(url) {
  for (let i = 1; ; i++) {
    try {
      return probe(url);
    } catch (e) {
      if (i >= 4) throw e;
      await sleep(3000 * i);
    }
  }
}

function encode(from, to, p, limit) {
  // The source's own bitrate as the ceiling keeps the file the size it was;
  // CRF 18 under it keeps the picture (the re-encode is a second generation).
  const kbps = Math.max(1500, Math.round((p.bitRate || 8e6) / 1000));
  const run = rate => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', from, '-map', '0', '-vf', tvFilter(),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-maxrate', `${rate}k`, '-bufsize', `${rate * 2}k`, '-profile:v', 'high',
    '-c:a', 'copy', '-movflags', '+faststart', to]);
  run(Math.round(kbps * 1.15));
  if (fs.statSync(to).size > limit && p.duration > 0) {
    run(Math.floor(((limit * 8) / p.duration) * 0.85 / 1000) - 200);
  }
  if (fs.statSync(to).size > limit) throw new Error(`re-encode is ${fs.statSync(to).size} bytes, over ${limit}`);
}

async function put(slug, copy, file) {
  const size = fs.statSync(file).size;
  const headers = { 'X-Shorts-Key': KEY, 'Content-Type': 'application/octet-stream' };
  let query = `copy=${copy}`;
  let body = fs.readFileSync(file);
  if (size > ONE_REQUEST) {
    const upload = `colour${slug}${copy}${Date.now().toString(36)}`.replace(/[^a-z0-9]/g, '').slice(0, 32);
    for (let i = 0, at = 0; at < size; i++, at += PART) {
      const res = await fetchRetry(`${TO}/stats/shorts/parts?upload=${upload}&index=${i}`,
        { method: 'POST', headers, body: body.subarray(at, Math.min(size, at + PART)) });
      if (!res.ok) throw new Error(`part ${i}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    query += `&upload=${upload}`;
    body = Buffer.alloc(0);
  }
  const res = await fetchRetry(`${TO}/stats/shorts/${slug}/video?${query}`, { method: 'PUT', headers, body });
  if (!res.ok) throw new Error(`replace ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const urlOf = (s, copy) => (copy === 'main' ? s.videoUrl : copy === 'hd' ? s.hdVideoUrl : s.linkVideoUrl);

const shorts = (await liveShorts()).filter(s => !ONLY.length || ONLY.includes(s.slug));
log(`${shorts.length} live Shorts`);
fs.mkdirSync(WORK, { recursive: true });
let fixed = 0, fine = 0, failed = 0;
for (const s of shorts) {
  for (const copy of ['main', 'hd', 'link']) {
    const rel = urlOf(s, copy);
    if (!rel) continue;
    const url = `${TO}${rel}`;
    let p;
    try {
      p = await probeUrl(url);
    } catch (e) {
      log(`${s.slug} ${copy}: could not probe (${e.message.split('\n')[0]})`);
      failed++;
      continue;
    }
    if (!isFull(p)) {
      fine++;
      continue;
    }
    if (DRY) {
      log(`${s.slug} ${s.kind} ${copy}: ${p.pixFmt} ${p.range}, would re-encode`);
      fixed++;
      continue;
    }
    const src = path.join(WORK, `${s.slug}.${copy}.src.mp4`);
    const out = path.join(WORK, `${s.slug}.${copy}.tv.mp4`);
    try {
      const got = await fetchRetry(url);
      if (!got.ok) throw new Error(`download ${got.status}`);
      fs.writeFileSync(src, Buffer.from(await got.arrayBuffer()));
      const local = probe(src);
      encode(src, out, local, limitOf(copy, s.kind));
      const now = probe(out);
      if (isFull(now)) throw new Error(`still ${now.pixFmt} ${now.range} after the encode`);
      if (Math.abs(now.duration - local.duration) > 0.2) throw new Error(`length moved ${local.duration} -> ${now.duration}`);
      const dto = await put(s.slug, copy, out);
      const live = await probeUrl(`${TO}${urlOf(dto, copy)}`);
      if (isFull(live)) throw new Error(`the live file is still ${live.pixFmt} ${live.range}`);
      log(`${s.slug} ${s.kind} ${copy}: ${(fs.statSync(src).size / 1e6).toFixed(1)} -> ${(fs.statSync(out).size / 1e6).toFixed(1)} MB, live at TV range`);
      fs.rmSync(src, { force: true });
      fs.rmSync(out, { force: true });
      fixed++;
    } catch (e) {
      log(`${s.slug} ${s.kind} ${copy}: FAILED ${e.message.split('\n')[0]}`);
      failed++;
    }
  }
}
log(`${DRY ? 'would re-encode' : 're-encoded'} ${fixed}, ${fine} already TV range, ${failed} failed`);
process.exit(failed ? 1 : 0);
