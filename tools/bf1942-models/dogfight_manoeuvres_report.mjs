#!/usr/bin/env node
// What wins in the recorded dogfights (features/dogfight-recordings,
// "What the manoeuvres did"): every manoeuvre in every extracted fight
// (`extract_dogfights.mjs`), named by `viewer/dogfight-manoeuvres.js` and
// scored on what it did for the pilot who flew it.
//
//   node dogfight_manoeuvres_report.mjs [viewer/replays/dogfights] [--json out.json] [--kind dogfight]
//        [--without <pilot name>]
//
// Prints a markdown table, one row a manoeuvre: how often it was flown, in
// how many fights, where the pilot stood before it, and after it how often
// he stood better or worse, had a shot that would land, faced one, and won
// or lost the fight. `--kind dogfight` counts the dogfights only (both
// shooting, or both turning), not the bounces.
//
// Then the same split three ways: by where he stood before it (chased, on
// his tail, neither), by who had the energy going in (his lead in height
// plus speed over `EVEN` metres either way), and by plane: fighter against
// bomber, each type's fights, and each fighter's answers when chased. A
// cell with fewer than `MIN` manoeuvres prints its counts, not percentages.
//
// A client recording sees the fights near the player who recorded it, so he
// is in many of them, and a strong pilot's record stands in for his plane's
// (the Yak9's 17 wins are one man's). `--without <name>` leaves every fight
// he is in out, to see whether a finding is his or everyone's.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(HERE, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(HERE, 'viewer'));
installModuleHooks(viewer);
const { recordedFight } = await import(pathToFileURL(path.join(viewer, 'dogfight-recorded.js')).href);
const M = await import(pathToFileURL(path.join(viewer, 'dogfight-manoeuvres.js')).href);
const { fighterRank } = await import(pathToFileURL(path.join(viewer, 'dogfight-lessons.js')).href);
/** Fewer than this in a cell and its percentages are not printed. */
const MIN = 5;
/** Energy within this of the other's, metres, is even. */
const EVEN = 50;
const classOf = tmpl => (fighterRank(tmpl) < 100 ? 'fighter' : 'bomber');

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dir = path.resolve(args.find((a, i) => !a.startsWith('--') && !['--json', '--kind', '--without'].includes(args[i - 1])) ?? path.join(viewer, 'replays', 'dogfights'));
const kind = opt('kind');
const without = opt('without');
const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
const rows = index.filter(r => (!kind || r.kind === kind) && (!without || !r.sides.some(s => s.name === without)));

const by = new Map();
const all = [];
let fights = 0;
for (const row of rows) {
  const raw = JSON.parse(await readFile(path.join(dir, `${row.id}.json`), 'utf8'));
  const fight = recordedFight(raw);
  const feats = M.features(fight);
  const moves = M.scoreManoeuvres(fight, M.nameManoeuvres(fight, M.M_RULES, feats), feats);
  fights++;
  for (const m of moves) {
    const mine = fight.templates[m.side], his = fight.templates[1 - m.side];
    all.push({ ...m, fight: row.id, plane: fight.planes[m.side], tmpl: mine, vs: fight.planes[1 - m.side],
               mineClass: classOf(mine), hisClass: classOf(his) });
  }
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
console.log(`${fights} fights${kind ? ` (${kind})` : ''}${without ? ` without ${without}` : ''}, ${table.reduce((n, s) => n + s.n, 0)} manoeuvres\n`);
console.log('| Manoeuvre | Flown | Fights | Before: on his tail / chased / neither | Better after | Worse after | Own shot | His shot | Won | Lost | Energy gained |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of table) {
  const b = s.before;
  console.log(`| ${s.name} | ${s.n} | ${s.fights} | ${b.offensive ?? 0} / ${b.defensive ?? 0} / ${(b.neutral ?? 0) + (b.headOn ?? 0) + (b.none ?? 0)}`
    + ` | ${pct(s.better, s.n)} | ${pct(s.worse, s.n)} | ${pct(s.myShot, s.n)} | ${pct(s.hisShot, s.n)} | ${pct(s.won, s.n)} | ${pct(s.lost, s.n)} | ${Math.round(s.energy / s.n)} m |`);
}
if (opt('json')) await writeFile(opt('json'), JSON.stringify({ fights, kind, rules: M.M_RULES.version, manoeuvres: table }, null, 1));

// --- the splits -----------------------------------------------------------------
const stat = list => {
  const n = list.length;
  if (n < MIN) {
    const w = list.filter(m => m.won).length, l = list.filter(m => m.lost).length;
    return { n, text: `${n} | (${w} won, ${l} lost)` };
  }
  const p = f => `${Math.round(100 * list.filter(f).length / n)}%`;
  return { n, text: `${n} | ${p(m => m.better > 0)} | ${p(m => m.better < 0)} | ${p(m => m.myShot)} | ${p(m => m.hisShot)} | ${p(m => m.won)} | ${p(m => m.lost)}` };
};
const HEAD = '| Flown | Better after | Worse after | Own shot | His shot | Won | Lost |';
const names = table.map(s => s.name);
const SIT = [['chased', m => m.before === 'defensive'], ['on his tail', m => m.before === 'offensive'], ['neither', m => m.before !== 'defensive' && m.before !== 'offensive']];
const NRG = [[`more energy (+${EVEN} m)`, m => m.lead > EVEN], ['even', m => Math.abs(m.lead) <= EVEN], [`less energy (-${EVEN} m)`, m => m.lead < -EVEN]];
const section = (title, groups) => {
  console.log(`\n### ${title}\n`);
  for (const [label, test] of groups) {
    console.log(`\n**${label[0].toUpperCase()}${label.slice(1)}**\n`);
    console.log(`| Manoeuvre ${HEAD}`);
    console.log('|---|---|---|---|---|---|---|---|');
    for (const name of names) {
      const list = all.filter(m => m.name === name && test(m));
      if (!list.length) continue;
      const st = stat(list);
      console.log(`| ${name} | ${st.text}${st.n < MIN ? ' | | | | |' : ''} |`);
    }
  }
};
section('By where he stood before it', SIT);
section('By who had the energy going in', NRG);

console.log('\n### By plane\n');
// Fighter against bomber: the fights, and who won them.
const fightRows = new Map();
for (const m of all) if (!fightRows.has(m.fight)) fightRows.set(m.fight, m);
const matchups = {};
for (const row of rows) {
  const raw = JSON.parse(await readFile(path.join(dir, `${row.id}.json`), 'utf8'));
  const [a, b] = raw.sides.map(s => classOf(s.tmpl));
  const key = [a, b].sort().join(' v ');
  const m = (matchups[key] ??= { fights: 0, kills: 0 });
  m.fights++;
  if (raw.kill) m.kills++;
}
console.log('| Matchup | Fights | Ending in a kill |');
console.log('|---|---|---|');
for (const [k, v] of Object.entries(matchups)) console.log(`| ${k} | ${v.fights} | ${v.kills} |`);
// Each type's fights: won, lost, and its manoeuvres when chased.
const types = new Map();
for (const row of rows) {
  for (const [i, s] of row.sides.entries()) {
    const t = (types.get(s.tmpl) ?? types.set(s.tmpl, { fights: 0, won: 0, lost: 0 }).get(s.tmpl));
    t.fights++;
    if (row.kill?.side === i) t.won++;
    else if (row.kill) t.lost++;
  }
}
console.log('\n| Plane | Fights | Won | Lost | Chased: its answers (flown, won, lost) |');
console.log('|---|---|---|---|---|');
for (const [tmpl, t] of [...types].sort((a, b) => b[1].fights - a[1].fights)) {
  if (t.fights < 10) continue;
  const chased = all.filter(m => m.tmpl === tmpl && m.before === 'defensive' && !['Tail chase', 'Climb', 'Dive'].includes(m.name));
  const answers = Object.entries(chased.reduce((o, m) => ((o[m.name] ??= []).push(m), o), {}))
    .filter(([, l]) => l.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .map(([name, l]) => `${name} ${l.length}, ${l.filter(m => m.won).length}, ${l.filter(m => m.lost).length}`)
    .join('; ');
  console.log(`| ${planeOf(tmpl)} | ${t.fights} | ${t.won} | ${t.lost} | ${answers || 'none twice'} |`);
}
function planeOf(tmpl) { return String(tmpl).replace(/_/g, ' '); }
