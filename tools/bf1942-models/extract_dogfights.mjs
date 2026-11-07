#!/usr/bin/env node
// Find the dogfights in round recordings and write them where the dogfight
// school's theatre plays them (features/dogfight-recordings).
//
//   node extract_dogfights.mjs <recording.ndjson>... [--out viewer/dogfights]
//        [--feed feed.json] [--report]
//   node extract_dogfights.mjs --download <dir> [--recent 50]
//
// Each recording is parsed with the viewer's own reader
// (`viewer/replay-recording.js`), searched with `viewer/dogfight-detect.js`,
// and every fight it finds is written to `<out>/<slug>-<n>.json`, with one
// row each in `<out>/index.json` (the rows of a recording run again are
// replaced). A recording's slug is its file name; `--feed` is the public
// feed's JSON (`/stats/recordings?pageSize=...`), for each slug's mod, level
// and date. `--report` prints what was found and writes nothing.
//
// `--download <dir>` fetches the newest public recordings (`--recent`, 50 by
// default) and their feed into `<dir>` first, then runs on them.
//
// Which templates are aircraft comes from the model catalogues the viewer
// loads (`models.json` on the assets site, vanilla's and each mod's:
// `category: 'air'`); `--catalogue <dir or url>` points elsewhere, and
// `--no-catalogue` leaves it to the detector's motion test alone.
//
// Each dogfight also gets its clip: the recording cut to the fight and
// `CLIP_LEAD` seconds either side (`viewer/recording-slice.js`), written as
// `<out>/<id>.ndjson`, which the replay page plays in 3D on the fight's map
// (the school's IN 3D buttons). `--clips all` writes one for every attack,
// `--clips none` none.

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(HERE, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(HERE, 'viewer'));
installModuleHooks(viewer);
const { parseRecording } = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);
const { findDogfights, sampleFight, RULES } = await import(pathToFileURL(path.join(viewer, 'dogfight-detect.js')).href);
const { sliceRecording } = await import(pathToFileURL(path.join(viewer, 'recording-slice.js')).href);

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flags = new Set(['--report']);
const valued = new Set(['--out', '--feed', '--download', '--recent', '--catalogue', '--clips']);
const clips = opt('clips', 'dogfights');
/** Seconds of the round a clip keeps before a fight and after it. */
const CLIP_LEAD = 5, CLIP_TAIL = 3;
const files = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const out = path.resolve(opt('out', path.join(viewer, 'dogfights')));
const report = args.includes('--report');
let feedFile = opt('feed');

const API = 'https://bfstats.io/stats/recordings';
if (opt('download')) {
  const dir = path.resolve(opt('download'));
  await mkdir(dir, { recursive: true });
  const want = Number(opt('recent', 50));
  const items = [];
  for (let page = 1; items.length < want; page++) {
    const res = await fetch(`${API}?pageSize=24&page=${page}&sort=recent`);
    const body = await res.json();
    const seen = new Set(items.map(i => i.slug));
    const fresh = (body.items ?? []).filter(i => !seen.has(i.slug));
    if (!fresh.length) break;
    items.push(...fresh);
  }
  items.length = Math.min(items.length, want);
  feedFile = path.join(dir, 'feed.json');
  await writeFile(feedFile, JSON.stringify(items));
  for (const item of items) {
    const file = path.join(dir, `${item.slug}.ndjson`);
    const have = await stat(file).then(s => s.size > 0, () => false);
    if (!have) {
      const res = await fetch(`${API}/${item.slug}.ndjson`);
      if (!res.ok) { console.warn(`${item.slug}: ${res.status}`); continue; }
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
    }
    files.push(file);
  }
}
for (const [i, f] of [...files.entries()]) {
  if ((await stat(f)).isDirectory()) {
    files.splice(i, 1, ...(await readdir(f)).filter(n => n.endsWith('.ndjson')).map(n => path.join(f, n)));
  }
}
if (!files.length) {
  console.error('usage: node extract_dogfights.mjs <recording.ndjson|dir>... [--out dir] [--feed feed.json] [--report] | --download <dir> [--recent N]');
  process.exit(2);
}

// The catalogues: template (lower case) -> whether it is an aircraft.
const CATALOGUES = ['models.json', 'mods/xpack1/models.json', 'mods/xpack2/models.json', 'mods/fhsweurope/models.json', 'mods/fhsw/models.json'];
const categories = new Map();
if (!args.includes('--no-catalogue')) {
  const base = opt('catalogue', 'https://mesh.bfstats.io/models/').replace(/\/?$/, '/');
  for (const name of CATALOGUES) {
    try {
      const text = /^https?:/.test(base)
        ? await fetch(base + name).then(r => (r.ok ? r.text() : null))
        : await readFile(path.join(base, name), 'utf8').catch(() => null);
      if (!text) continue;
      for (const m of JSON.parse(text)) {
        const key = String(m.name ?? '').toLowerCase();
        if (key && !categories.has(key)) categories.set(key, m.category === 'air');
      }
    } catch (e) {
      console.warn(`catalogue ${name}: ${e.message}`);
    }
  }
  console.error(`catalogue: ${categories.size} templates, ${[...categories.values()].filter(Boolean).length} aircraft`);
}
const air = categories.size ? tmpl => categories.get(String(tmpl).toLowerCase()) ?? null : null;

const feed = new Map();
if (feedFile) {
  const raw = JSON.parse(await readFile(feedFile, 'utf8'));
  for (const item of Array.isArray(raw) ? raw : raw.items ?? []) feed.set(item.slug, item);
}

const indexFile = path.join(out, 'index.json');
let index = [];
if (!report) {
  await mkdir(out, { recursive: true });
  index = await readFile(indexFile, 'utf8').then(JSON.parse, () => []);
}

const tally = { recordings: 0, fights: 0, dogfights: 0, kills: 0 };
for (const file of files) {
  const slug = path.basename(file, '.ndjson');
  let rec, text;
  try {
    text = await readFile(file, 'utf8');
    rec = parseRecording(text);
  } catch (e) {
    console.warn(`${slug}: ${e.message}`);
    continue;
  }
  tally.recordings++;
  const item = feed.get(slug);
  const meta = {
    slug, mod: item?.mod ?? rec.mod ?? null, level: item?.level ?? rec.level ?? null,
    recorded: (item?.recordedLocal ?? rec.start ?? '').slice(0, 10) || null,
    server: item?.serverName ?? rec.server ?? null, source: item?.source ?? (rec.serverFile ? 'server' : 'client'),
  };
  const fights = findDogfights(rec, RULES, { air });
  const rows = [];
  for (const [n, fight] of fights.entries()) {
    const id = `${slug}-${n + 1}`;
    const sampled = sampleFight(rec, fight);
    const row = {
      id, ...meta, t0: sampled.t0, duration: sampled.duration, kind: sampled.kind, mutual: sampled.mutual,
      closest: sampled.closest,
      kill: sampled.kill ? { side: sampled.kill.side, t: sampled.kill.t, weapon: sampled.kill.weapon } : null,
      end: sampled.end ?? null,
      sides: sampled.sides.map(s => ({ name: s.name, team: s.team, tmpl: s.tmpl, aimed: s.aimed, hits: s.hits, turned: s.turned })),
    };
    rows.push(row);
    tally.fights++;
    if (row.kind === 'dogfight') tally.dogfights++;
    if (row.kill) tally.kills++;
    if (report) {
      const [a, b] = row.sides;
      console.log(`${id} ${meta.level} t=${Math.round(row.t0)} ${row.duration.toFixed(0)}s ${row.kind}${row.mutual ? ' mutual' : ''}`
        + ` ${a.name} (${a.tmpl}, ${a.aimed} aimed, ${a.hits} hits) v ${b.name} (${b.tmpl}, ${b.aimed} aimed, ${b.hits} hits)`
        + ` closest ${row.closest} m${row.kill ? ` KILL by ${row.sides[row.kill.side].name}` : ''}`);
    } else {
      let clip = null;
      if (clips === 'all' || (clips === 'dogfights' && sampled.kind === 'dogfight')) {
        const from = Math.max(0, fight.t0 - CLIP_LEAD), to = Math.min(rec.duration, fight.t1 + CLIP_TAIL);
        await writeFile(path.join(out, `${id}.ndjson`), sliceRecording(text, from, to, { id, slug }));
        clip = { file: `${id}.ndjson`, lead: Math.round((fight.t0 - from) * 1000) / 1000, from: Math.round(from * 1000) / 1000 };
        row.clip = true;
      }
      await writeFile(path.join(out, `${id}.json`), JSON.stringify({ id, meta, rules: RULES.version, clip, ...sampled }));
    }
  }
  if (!report) index = index.filter(r => r.slug !== slug).concat(rows);
  console.error(`${slug} ${meta.level}: ${fights.length} fights`);
}
if (!report) {
  index.sort((a, b) => (b.recorded ?? '').localeCompare(a.recorded ?? '') || a.slug.localeCompare(b.slug) || a.t0 - b.t0);
  await writeFile(indexFile, JSON.stringify(index, null, 1));
}
console.error(JSON.stringify(tally));
