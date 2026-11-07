#!/usr/bin/env node
// What wins in the recorded dogfights (features/dogfight-recordings,
// "What the manoeuvres did"): every manoeuvre in every extracted fight
// (`extract_dogfights.mjs`), named by `viewer/dogfight-manoeuvres.js` and
// scored on what it did for the pilot who flew it.
//
//   node dogfight_manoeuvres_report.mjs [viewer/dogfights] [--json out.json] [--kind dogfight]
//
// Prints a markdown table, one row a manoeuvre: how often it was flown, in
// how many fights, where the pilot stood before it, and after it how often
// he stood better or worse, had a shot that would land, faced one, and won
// or lost the fight. `--kind dogfight` counts the dogfights only (both
// shooting, or both turning), not the bounces.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(HERE, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(HERE, 'viewer'));
installModuleHooks(viewer);
const { recordedFight } = await import(pathToFileURL(path.join(viewer, 'dogfight-recorded.js')).href);
const M = await import(pathToFileURL(path.join(viewer, 'dogfight-manoeuvres.js')).href);

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dir = path.resolve(args.find((a, i) => !a.startsWith('--') && !['--json', '--kind'].includes(args[i - 1])) ?? path.join(viewer, 'dogfights'));
const kind = opt('kind');
const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
const rows = kind ? index.filter(r => r.kind === kind) : index;

const by = new Map();
let fights = 0;
for (const row of rows) {
  const raw = JSON.parse(await readFile(path.join(dir, `${row.id}.json`), 'utf8'));
  const fight = recordedFight(raw);
  const feats = M.features(fight);
  const moves = M.scoreManoeuvres(fight, M.nameManoeuvres(fight, M.M_RULES, feats), feats);
  fights++;
  const seen = new Set();
  for (const m of moves) {
    if (!by.has(m.name)) by.set(m.name, { name: m.name, n: 0, fights: 0, before: {}, better: 0, worse: 0, myShot: 0, hisShot: 0, won: 0, lost: 0, energy: 0 });
    const s = by.get(m.name);
    s.n++;
    if (!seen.has(m.name)) { s.fights++; seen.add(m.name); }
    s.before[m.before ?? 'none'] = (s.before[m.before ?? 'none'] ?? 0) + 1;
    if (m.better > 0) s.better++;
    if (m.better < 0) s.worse++;
    if (m.myShot) s.myShot++;
    if (m.hisShot) s.hisShot++;
    if (m.won) s.won++;
    if (m.lost) s.lost++;
    s.energy += m.energy;
  }
}
const pct = (a, n) => `${Math.round(100 * a / Math.max(1, n))}%`;
const order = new Map(M.MANOEUVRES.map(([name], i) => [name, i]));
const table = [...by.values()].sort((a, b) => order.get(a.name) - order.get(b.name));
console.log(`${fights} fights${kind ? ` (${kind})` : ''}, ${table.reduce((n, s) => n + s.n, 0)} manoeuvres\n`);
console.log('| Manoeuvre | Flown | Fights | Before: on his tail / chased / neither | Better after | Worse after | Own shot | His shot | Won | Lost | Energy gained |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of table) {
  const b = s.before;
  console.log(`| ${s.name} | ${s.n} | ${s.fights} | ${b.offensive ?? 0} / ${b.defensive ?? 0} / ${(b.neutral ?? 0) + (b.headOn ?? 0) + (b.none ?? 0)}`
    + ` | ${pct(s.better, s.n)} | ${pct(s.worse, s.n)} | ${pct(s.myShot, s.n)} | ${pct(s.hisShot, s.n)} | ${pct(s.won, s.n)} | ${pct(s.lost, s.n)} | ${Math.round(s.energy / s.n)} m |`);
}
if (opt('json')) await writeFile(opt('json'), JSON.stringify({ fights, kind, rules: M.M_RULES.version, manoeuvres: table }, null, 1));
