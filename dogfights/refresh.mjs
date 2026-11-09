#!/usr/bin/env node
// Keeps the schools' fights lists fresh: the bfstats-dogfights CronJob
// (deploy/app/dogfights-cronjob.yaml, features/dogfight-recordings). Two
// lists, each from the same feed and each with a live build of its own: the
// dogfight school's (extract_dogfights.mjs, `<replays>/dogfights`) and the
// tank school's (extract_tank_fights.mjs, `<replays>/tankfights`,
// features/battle-schools). One list failing leaves the other's as built,
// and the run exits non-zero at the end.
//
//   node refresh.mjs [--force] [--only dogfights|tankfights]
//
// 1. Reads the public REPLAY feed from the API, every page.
// 2. Fingerprints it (each recording's slug, mod, level, date, server, source,
//    file size) with this image's code version. When the live build carries
//    the same fingerprint nothing has changed, and it stops there.
// 3. Runs extract_dogfights.mjs over the feed's recordings, read in place
//    from the API's recordings volume (`<slug>.ndjson.gz`), into a fresh
//    folder beside the live one: `<replays>/.dogfights/<stamp>`.
// 4. Makes it world-readable for nginx, then points `<replays>/dogfights` at
//    it with one rename of a symlink, so the site serves the old list or the
//    new one, never half of either.
// 5. Keeps the build it replaced (a page that loaded the old index can still
//    open its fights) and removes every older one.
//
// Settings come from the environment (the CronJob's), defaults in brackets:
//   DOGFIGHTS_API         the feed [http://bf42-stats-service:8080/stats/recordings]
//   DOGFIGHTS_RECORDINGS  the API's recordings directory [/recordings]
//   DOGFIGHTS_REPLAYS     the assets volume's mesh/replays [/replays]
//   DOGFIGHTS_CATALOGUE   the assets volume's mesh/models [/models]
//   DOGFIGHTS_MESH        the assets volume's mesh/ root, for the tank
//                         extractor's AI data, catalogues and glbs [/mesh]
//   DOGFIGHTS_MAX_MB      skip a recording bigger than this unpacked [96]
//   DOGFIGHTS_HEAP_MB     the extractors' heap [640]
//
// Steps 3 to 5 are run once per list.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (name, fallback) => process.env[name] || fallback;
const API = env('DOGFIGHTS_API', 'http://bf42-stats-service:8080/stats/recordings');
const RECORDINGS = env('DOGFIGHTS_RECORDINGS', '/recordings');
const REPLAYS = env('DOGFIGHTS_REPLAYS', '/replays');
const CATALOGUE = env('DOGFIGHTS_CATALOGUE', '/models');
const MESH = env('DOGFIGHTS_MESH', '/mesh');
const MAX_MB = env('DOGFIGHTS_MAX_MB', '96');
const HEAP_MB = env('DOGFIGHTS_HEAP_MB', '640');
const TOOLS = path.join(HERE, '..', 'tools', 'bf1942-models');
const force = process.argv.includes('--force');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const TMP = process.env.TMPDIR || '/tmp';

/** The lists: where each goes, and how its extractor is run. */
const LISTS = [
  { name: 'dogfights', extractor: path.join(TOOLS, 'extract_dogfights.mjs'), args: ['--catalogue', CATALOGUE] },
  // The tank extractor reads the trees' AI data, catalogues and glbs from the
  // mesh root as the site serves it, and keeps its glb facts in a cache the
  // job's own (temporary) disk can hold.
  { name: 'tankfights', extractor: path.join(TOOLS, 'extract_tank_fights.mjs'),
    args: ['--catalogue', MESH, '--glb-cache', path.join(TMP, 'tankfights-glb-guns.json')] },
].filter(l => !only || l.name === only);
const log = (...a) => console.log(new Date().toISOString(), ...a);

/** This image's code: VERSION is written when the image is built. */
const version = await readFile(path.join(HERE, 'VERSION'), 'utf8').then(s => s.trim(), () => 'dev');

// 1. The feed, every page. A page is tried four times over about a minute:
//    the API answers 503 while it restarts or is busy.
async function feedPage(page) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}?pageSize=24&page=${page}&sort=recent`).catch(e => ({ ok: false, status: e.message }));
    if (res.ok) return res.json();
    if (attempt === 4) throw new Error(`feed page ${page}: ${res.status}; the live list is left as it is`);
    log(`feed page ${page}: ${res.status}, again in ${attempt * 10} s`);
    await new Promise(r => setTimeout(r, attempt * 10_000));
  }
}
const items = [];
for (let page = 1; ; page++) {
  const body = await feedPage(page);
  const seen = new Set(items.map(i => i.slug));
  const fresh = (body.items ?? []).filter(i => !seen.has(i.slug));
  items.push(...fresh);
  if (!fresh.length || page >= (body.totalPages ?? page)) break;
}
// An empty feed is far likelier an API fault than a site with no recordings:
// keep the list there is.
if (!items.length) throw new Error('the feed is empty; the live list is left as it is');

// 2. What the list is built from.
const files = [];
const inputs = [];
for (const item of items) {
  let file = null, size = 0;
  for (const name of [`${item.slug}.ndjson.gz`, `${item.slug}.ndjson`]) {
    const s = await stat(path.join(RECORDINGS, name)).catch(() => null);
    if (s) { file = path.join(RECORDINGS, name); size = s.size; break; }
  }
  if (!file) { log(`${item.slug}: in the feed, not in ${RECORDINGS}; left out`); continue; }
  files.push(file);
  inputs.push([item.slug, item.mod, item.level, item.recordedLocal, item.serverName, item.source, size]);
}
// The API takes a recording whose file has gone out of the feed
// (RecordingFileReconciler), so most of the feed missing means the volume is
// not what it should be (not mounted, the wrong one), not that they are gone.
if (files.length < items.length / 2) {
  throw new Error(`only ${files.length} of ${items.length} recordings in ${RECORDINGS}; the live list is left as it is`);
}
inputs.sort((a, b) => a[0].localeCompare(b[0]));
const feedFile = path.join(TMP, 'fights-feed.json');
await writeFile(feedFile, JSON.stringify(items));
log(`feed: ${items.length} recordings, ${files.length} on disk; version ${version}`);

let failed = 0;
for (const list of LISTS) {
  try {
    await refresh(list);
  } catch (e) {
    failed++;
    log(`${list.name}: ${e.message}`);
  }
}
if (failed) process.exit(1);

/** Steps 3 to 5 for one list: build beside its live one, swap, prune. */
async function refresh({ name, extractor, args }) {
  const LIVE = path.join(REPLAYS, name);
  const BUILDS = path.join(REPLAYS, `.${name}`);
  const fingerprint = createHash('sha256').update(JSON.stringify({ version, maxMb: MAX_MB, inputs })).digest('hex').slice(0, 16);
  const live = await readFile(path.join(LIVE, 'build.json'), 'utf8').then(JSON.parse, () => null);
  log(`${name}: fingerprint ${fingerprint}, live ${live?.fingerprint ?? 'none'}`);
  if (!force && live?.fingerprint === fingerprint) {
    log(`${name}: unchanged; nothing to do`);
    return;
  }

  // 3. Build beside the live list, on the same volume, so the swap is a rename.
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const partial = path.join(BUILDS, `${stamp}.partial`);
  const build = path.join(BUILDS, stamp);
  await mkdir(BUILDS, { recursive: true });
  for (const entry of await readdir(BUILDS)) {
    if (entry.endsWith('.partial')) await rm(path.join(BUILDS, entry), { recursive: true, force: true });
  }
  await mkdir(partial);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      `--max-old-space-size=${HEAP_MB}`, extractor, ...files,
      '--feed', feedFile, '--out', partial, ...args, '--max-mb', MAX_MB,
    ], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (c, signal) => resolve(signal ? 128 : c));
  });
  if (code !== 0) {
    await rm(partial, { recursive: true, force: true });
    throw new Error(`extractor exited ${code}; the live list is left as it is`);
  }
  const index = JSON.parse(await readFile(path.join(partial, 'index.json'), 'utf8'));
  if (!Array.isArray(index)) throw new Error('index.json is not a list');
  await writeFile(path.join(partial, 'build.json'), JSON.stringify({
    built: new Date().toISOString(), version, fingerprint, recordings: files.length, fights: index.length,
  }, null, 1));

  // 4. Readable by nginx (its workers are in group 1000 too, but a file is
  //    a+r either way: the publish scripts' rule), then the swap.
  await chmod(partial, 0o755);
  for (const entry of await readdir(partial)) await chmod(path.join(partial, entry), 0o644);
  await rename(partial, build);

  const before = await lstat(LIVE).catch(() => null);
  let previous = before?.isSymbolicLink() ? path.basename(await readlink(LIVE)) : null;
  if (before && !before.isSymbolicLink()) {
    // A folder published by hand: moved into the builds once, after which every
    // swap is the single rename below. The site misses it for that one moment.
    previous = `${stamp}-by-hand`;
    await rename(LIVE, path.join(BUILDS, previous));
  }
  const next = path.join(REPLAYS, `.${name}-next`);
  await rm(next, { force: true });
  await symlink(path.join(`.${name}`, stamp), next);
  await rename(next, LIVE);
  log(`${name}: live ${stamp}, ${index.length} fights from ${files.length} recordings (was ${previous ?? 'nothing'})`);

  // 5. Keep the live build and the one it replaced.
  for (const entry of await readdir(BUILDS)) {
    if (entry !== stamp && entry !== previous) await rm(path.join(BUILDS, entry), { recursive: true, force: true });
  }
}
