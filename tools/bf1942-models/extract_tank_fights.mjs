#!/usr/bin/env node
// Find the tank fights in round recordings and write them where the tank
// school lists them (features/battle-schools, "Tank fights from the
// recordings").
//
//   node extract_tank_fights.mjs <recording.ndjson|dir>... [--out viewer/replays/tankfights]
//        [--feed feed.json] [--report]
//   node extract_tank_fights.mjs --download <dir> [--recent 50]
//
// Each recording is parsed with the viewer's own reader
// (`viewer/replay-recording.js`), searched with `viewer/tank-fights-detect.js`,
// and every fight is written to `<out>/<slug>-<n>.json` (both hulls every
// 0.2 s, heading, turret yaw, hit points, every main-gun shot), with one row
// each in `<out>/index.json` (a recording run again has its rows replaced).
// `--feed` is the public feed's JSON, for each slug's mod, level and date.
// `--report` prints what was found and writes nothing. `--download <dir>`
// fetches the newest public recordings (`--recent`, 50 by default) and their
// feed into `<dir>` first, as `extract_dogfights.mjs` does.
//
// What a tank is, and its weight, comes from the trees the viewer loads off
// the assets site (`--catalogue <url or dir>`, mesh.bfstats.io by default):
// the game's AI data (`maps/<tree>/_shared/vehicle-ai.json`: a tank is
// `class: 'Land'`, `equipmentType: 0`) and the model catalogue
// (`models/<tree>/models.json`, `tank-arena.js` `isTank`), the recording's
// own mod's tree first, then vanilla's. Each tank's glb gives its guns'
// muzzle speed and `gravityModifier` and its `vehicleType`; the guns are
// cached in `~/.cache/bfstats-tankfights/glb-guns.json` (`--glb-cache`).
//
// `--max-mb <n>` skips a recording bigger than n MB unpacked.

import { readFile, writeFile, mkdir, readdir, stat, open } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(HERE, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(HERE, 'viewer'));
installModuleHooks(viewer);
const { parseRecording } = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);
const D = await import(pathToFileURL(path.join(viewer, 'tank-fights-detect.js')).href);
const { isTank } = await import(pathToFileURL(path.join(viewer, 'tank-arena.js')).href);
const { decodePlayerName } = await import(pathToFileURL(path.join(viewer, 'vehicle-players.js')).href);

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const valued = new Set(['--out', '--feed', '--download', '--recent', '--catalogue', '--max-mb', '--glb-cache']);
const files = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const out = path.resolve(opt('out', path.join(viewer, 'replays', 'tankfights')));
const report = args.includes('--report');
const maxBytes = opt('max-mb') ? Number(opt('max-mb')) * 1024 * 1024 : Infinity;
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
for (const [i, f] of [...files.entries()].reverse()) {
  if ((await stat(f)).isDirectory()) {
    files.splice(i, 1, ...(await readdir(f)).filter(n => /\.ndjson(\.gz)?$/.test(n)).map(n => path.join(f, n)));
  }
}
if (!files.length) {
  console.error('usage: node extract_tank_fights.mjs <recording.ndjson|dir>... [--out dir] [--feed feed.json] [--report] | --download <dir> [--recent N]');
  process.exit(2);
}

// --- the trees: catalogue, AI data, guns ------------------------------------

const BASE = opt('catalogue', 'https://mesh.bfstats.io/').replace(/\/?$/, '/').replace(/models\/$/, '');
const TREES = ['', 'xpack1', 'xpack2', 'fhsweurope', 'fhsw'];
const treeOf = mod => {
  const m = String(mod ?? '').toLowerCase();
  return TREES.includes(m) && m ? m : '';
};
const treePath = (tree, kind) => (tree ? `${kind}/mods/${tree}/` : `${kind}/`);
async function readText(rel) {
  try {
    if (/^https?:/.test(BASE)) {
      const res = await fetch(BASE + rel);
      return res.ok ? await res.text() : null;
    }
    return await readFile(path.join(BASE, rel), 'utf8');
  } catch {
    return null;
  }
}
const trees = new Map(); // tree -> { rows: Map<lower name, row>, ai: { name: entry } }
async function treeData(tree) {
  if (trees.has(tree)) return trees.get(tree);
  const data = { rows: new Map(), ai: {} };
  const cat = await readText(`${treePath(tree, 'models')}models.json`);
  if (cat) for (const row of JSON.parse(cat)) data.rows.set(String(row.name).toLowerCase(), row);
  const ai = await readText(`${treePath(tree, 'maps')}_shared/vehicle-ai.json`);
  if (ai) data.ai = JSON.parse(ai).vehicles ?? {};
  console.error(`tree ${tree || 'bf1942'}: ${data.rows.size} models, ${Object.keys(data.ai).length} AI vehicles`);
  trees.set(tree, data);
  return data;
}

/** Rule 1's test for a recording of `mod`: the tree's own word first. */
async function tankTest(mod) {
  const own = await treeData(treeOf(mod));
  const base = await treeData('');
  return tmpl => {
    const key = String(tmpl).toLowerCase();
    for (const [tree, data] of [[treeOf(mod), own], ['', base]]) {
      const row = data.rows.get(key);
      const aiKey = row?.name ?? Object.keys(data.ai).find(k => k.toLowerCase() === key);
      const ai = aiKey ? data.ai[aiKey] : null;
      if (!row && !ai) continue;
      // The AI's word where it has one (`class: 'Land'`, `equipmentType: 0`)
      // and a main gun to show for it; `isTank`'s catalogue rule where it has
      // none (FHSW's King Tiger, StuG III B and Cruiser Mk II are not in its
      // AI data). `isTank(row, ai)` alone also drops an AI tank whose gun the
      // AI does not rate (FHSW's M36, `M36GunBarrelAP`).
      const aiTank = ai && String(ai.class).toLowerCase() === 'land' && Number(ai.equipmentType) === 0;
      const tank = ai
        ? aiTank && ((row && isTank(row, data.ai)) || (row?.weapons ?? []).some(D.isMainGunShot) || !row)
        : isTank(row);
      if (!tank) return null;
      return { hpMax: Number(row?.hitpoints) || null, strType: ai?.strType ?? null, basicTemp: ai?.basicTemp ?? null, tree, row };
    }
    return null;
  };
}

/** A glb's vehicleType that no tank has: a self-propelled howitzer (vanilla's
 *  Sexton and Priest, FHSW's Sturmpanzer II), a half-track carrying a gun. */
const NOT_TANK_TYPES = /^VT(Artillery|Apc)$/i;

const glbCacheFile = path.resolve(opt('glb-cache', path.join(os.homedir(), '.cache', 'bfstats-tankfights', 'glb-guns.json')));
const glbCache = await readFile(glbCacheFile, 'utf8').then(JSON.parse, () => ({}));
let glbDirty = false;
/** A tank glb's guns (`{ weapon: { speed, gravity } }`) and vehicleType. */
async function glbFacts(info) {
  const row = info.row;
  if (!row?.glb) return null;
  const url = row.sha ? `${BASE}glbs/${row.sha}.glb` : `${BASE}${treePath(info.tree, 'models')}${row.glb}`;
  if (glbCache[url] !== undefined) return glbCache[url];
  let facts = null;
  try {
    const bytes = /^https?:/.test(url)
      ? Buffer.from(await fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))))
      : await readFile(url);
    const length = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
    facts = { vehicleType: null, guns: {} };
    for (const node of json.nodes ?? []) {
      const ex = node.extras ?? {};
      if (ex.physics?.vehicleType && String(node.name).toLowerCase() === String(row.name).toLowerCase()) facts.vehicleType = ex.physics.vehicleType;
      if (ex.physics?.vehicleType && !facts.vehicleType) facts.vehicleType = ex.physics.vehicleType;
      const fa = ex.fireArms;
      if (!fa || !node.name) continue;
      const speed = Number(fa.velocity), gravity = Number(fa.projectile?.gravity);
      facts.guns[node.name] = { speed: speed > 0 ? speed : 100, gravity: Number.isFinite(gravity) && fa.projectile?.gravity !== null ? gravity : 1 };
    }
  } catch (e) {
    console.warn(`glb ${row.name}: ${e.message}`);
  }
  glbCache[url] = facts;
  glbDirty = true;
  return facts;
}

// --- the run ----------------------------------------------------------------

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

async function unpackedSize(file) {
  if (!file.endsWith('.gz')) return (await stat(file)).size;
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tail = Buffer.alloc(4);
    await fh.read(tail, 0, 4, Math.max(0, size - 4));
    return tail.readUInt32LE(0);
  } finally {
    await fh.close();
  }
}

const r1 = v => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const tally = { recordings: 0, fights: 0, kills: 0, upsets: 0, fullHp: 0, skipped: 0 };
for (const file of files) {
  const slug = path.basename(file).replace(/\.ndjson(\.gz)?$/, '');
  let rec;
  try {
    const size = await unpackedSize(file);
    if (size > maxBytes) { console.warn(`${slug}: over --max-mb; skipped`); tally.skipped++; continue; }
    const text = file.endsWith('.gz') ? gunzipSync(await readFile(file)).toString('utf8') : await readFile(file, 'utf8');
    rec = parseRecording(text);
  } catch (e) {
    console.warn(`${slug}: ${e.message}`);
    continue;
  }
  tally.recordings++;
  const item = feed.get(slug);
  const mod = String(item?.mod ?? rec.mod ?? 'bf1942').toLowerCase() || 'bf1942';
  const meta = {
    slug, mod, level: item?.level ?? rec.level ?? null,
    date: (item?.recordedLocal ?? rec.start ?? '').slice(0, 10) || null,
    server: item?.serverName ?? rec.server ?? null, source: item?.source ?? (rec.serverFile ? 'server' : 'client'),
  };
  const test = await tankTest(mod);
  // Each tank's glb, for its guns and vehicleType, before the search. The AI
  // calls vanilla's Sexton a tank (equipmentType 0); its glb says artillery.
  const infos = new Map();
  for (const life of rec.lives) {
    const key = String(life.tmpl ?? '').toLowerCase();
    if (!key || infos.has(key) || life.soldier) continue;
    let info = test(life.tmpl);
    if (info) {
      info.glb = await glbFacts(info);
      info.vehicleType = info.glb?.vehicleType ?? null;
      if (NOT_TANK_TYPES.test(info.vehicleType ?? '')) info = null;
    }
    infos.set(key, info);
  }
  const tank = tmpl => infos.get(String(tmpl).toLowerCase()) ?? null;
  const gun = (tmpl, weapon) => {
    const guns = tank(tmpl)?.glb?.guns;
    if (!guns) return null;
    return guns[weapon] ?? Object.entries(guns).find(([k]) => k.toLowerCase() === String(weapon).toLowerCase())?.[1] ?? null;
  };
  const fights = D.findTankFights(rec, D.RULES, { tank, gun });
  const rows = [];
  for (const [n, fight] of fights.entries()) {
    const id = `${slug}-${n + 1}`;
    const side = s => ({
      name: s.name, nameShown: decodePlayerName(s.name), team: s.team, template: s.tmpl, weight: s.weight,
      hpStart: r1(s.hpStart), hpMax: r1(s.hpMax), shots: s.shots, aimed: s.aimed, hits: s.hits,
      vehicleType: s.vehicleType, ...(s.gunners.length ? { gunners: s.gunners.map(g => g.name) } : {}),
    });
    const t0 = Math.round(fight.t0 * 10) / 10;
    const row = {
      id, recording: slug, mod, level: meta.level, date: meta.date, source: meta.source,
      t0, t1: Math.round(fight.t1 * 10) / 10, duration: Math.round((fight.t1 - fight.t0) * 10) / 10,
      ending: fight.end.why, killAt: fight.kill ? Math.round(fight.kill.t * 10) / 10 : null,
      range: fight.range === null ? null : Math.round(fight.range), rangeHow: fight.rangeHow,
      fullHpStart: fight.fullHpStart, upset: fight.upset, mutual: fight.mutual,
      closest: fight.closest === null ? null : Math.round(fight.closest),
      longestHit: fight.longestHit === null ? null : Math.round(fight.longestHit),
      score: D.scoreOf(fight), winner: fight.winner === null ? null : fight.winner === 0 ? 'a' : 'b',
      a: side(fight.sides[0]), b: side(fight.sides[1]),
      ...(fight.end.by ? { endBy: { name: fight.end.by.name, weapon: fight.end.by.weapon } } : {}),
      replay: `map.html?mod=${encodeURIComponent(mod)}&map=${encodeURIComponent(meta.level ?? '')}`
        + `&replay=${encodeURIComponent(`/stats/recordings/${slug}.ndjson`)}&t=${Math.max(0, Math.floor(fight.t0))}`,
    };
    rows.push(row);
    tally.fights++;
    if (row.killAt !== null) tally.kills++;
    if (row.upset) tally.upsets++;
    if (row.fullHpStart) tally.fullHp++;
    if (report) {
      const w = row.winner ? row[row.winner].name : null;
      console.log(`${id} ${meta.level} t=${Math.round(row.t0)} ${row.duration}s ${row.ending}${w ? ` (${w})` : ''}`
        + ` ${row.a.name} (${row.a.template} ${row.a.weight} ${row.a.hpStart}/${row.a.hpMax}, ${row.a.aimed}/${row.a.shots} aimed, ${row.a.hits} hits)`
        + ` v ${row.b.name} (${row.b.template} ${row.b.weight} ${row.b.hpStart}/${row.b.hpMax}, ${row.b.aimed}/${row.b.shots} aimed, ${row.b.hits} hits)`
        + `${row.range !== null ? ` range ${row.range} m (${row.rangeHow})` : ''}${row.upset ? ' UPSET' : ''}${row.fullHpStart ? ' full-hp' : ''} score ${row.score}`);
    } else {
      const sampled = D.sampleTankFight(rec, fight, { gun });
      await writeFile(path.join(out, `${id}.json`), JSON.stringify({ id, meta, rules: D.RULES.version, row, ...sampled }));
    }
  }
  if (!report) index = index.filter(r => r.recording !== slug).concat(rows);
  console.error(`${slug} ${meta.level}: ${fights.length} tank fights`);
}
if (glbDirty) {
  await mkdir(path.dirname(glbCacheFile), { recursive: true });
  await writeFile(glbCacheFile, JSON.stringify(glbCache));
}
if (!report) {
  index.sort((a, b) => b.score - a.score || (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id));
  await writeFile(indexFile, JSON.stringify(index, null, 1));
}
tally.maxRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
console.error(JSON.stringify(tally));
