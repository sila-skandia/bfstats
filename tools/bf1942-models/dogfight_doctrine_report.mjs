#!/usr/bin/env node
// Which of Boelcke's rules pay in the players' own fights
// (features/dogfight-doctrine, "What the recordings say"): every extracted
// fight (`extract_dogfights.mjs`) measured by `viewer/dogfight-doctrine.js`,
// and each rule's measure set against what followed.
//
//   node dogfight_doctrine_report.mjs [viewer/replays/dogfights] [--suns suns.json] [--json out.json]
//        [--kind dogfight] [--without <pilot name>]
//
// `--suns` maps a level to its `scene.json` `sunDirection` (the exporter's
// glTF frame; the sun sits along (-x, y, -z) of it, as `level-flare.js`
// draws it), so each attack carries the angle between the sun and the
// attacker as the target sees him. Without it, rule 1's sun is not
// reported.
//
// Every fight's guns are vanilla's (the wing guns' convergence, 268 m):
// the recordings are vanilla's but for a handful of FHSW and Road to Rome
// fights, whose guns the extracted fights do not name.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(HERE, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(HERE, 'viewer'));
installModuleHooks(viewer);
const { recordedFight } = await import(pathToFileURL(path.join(viewer, 'dogfight-recorded.js')).href);
const { doctrineOf, DOCTRINE } = await import(pathToFileURL(path.join(viewer, 'dogfight-doctrine.js')).href);
const { gunOf } = await import(pathToFileURL(path.join(viewer, 'dogfight-pilot.js')).href);

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const valued = new Set(['--suns', '--json', '--kind', '--without']);
const dir = path.resolve(args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1])) ?? path.join(viewer, 'replays', 'dogfights'));
const kind = opt('kind'), without = opt('without');
const suns = opt('suns') ? JSON.parse(await readFile(opt('suns'), 'utf8')) : {};
const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
const rows = index.filter(r => (!kind || r.kind === kind) && (!without || !r.sides.some(s => s.name === without)));
const gun = gunOf({ speed: 400, reach: 600, span: 2.5, converge: 1.6 });
/** Fewer than this in a cell and its percentages are not printed. */
const MIN = 5;

const attacks = [], dives = [], bursts = [], sights = [], endings = {};
for (const row of rows) {
  const raw = JSON.parse(await readFile(path.join(dir, `${row.id}.json`), 'utf8'));
  const fight = recordedFight(raw);
  const sd = suns[row.level];
  const sun = sd ? [-sd[0], sd[1], -sd[2]] : null;
  const doc = doctrineOf(fight, { guns: [gun, gun], sun });
  const winner = fight.end?.why === 'shot down' ? fight.end.winner : null;
  endings[row.end?.why ?? 'none'] = (endings[row.end?.why ?? 'none'] ?? 0) + 1;
  doc.sides.forEach((side, s) => {
    for (const a of side.attacks) attacks.push({ ...a, fight: row.id, side: s, won: winner === s, lost: winner === 1 - s });
    for (const b of side.bursts) bursts.push({ ...b, side: s });
    for (const d of side.dives) dives.push({ ...d, fight: row.id, side: s, won: winner === s, lost: winner === 1 - s });
    if (winner !== null) sights.push({ sight: side.sight, won: winner === s });
  });
}

const pct = (a, b) => (b >= MIN ? `${Math.round(100 * a / b)}%` : `${a}/${b}`);
const row = cells => `| ${cells.join(' | ')} |`;
const out = [];
const attackTable = (title, groups) => {
  out.push(`\n**${title}**\n`, row(['', 'Attacks', 'Landed a shot', 'Hit them', 'Hits an attack', 'Won the fight', 'Lost it']), row(['---', '---', '---', '---', '---', '---', '---']));
  for (const [name, list] of groups) {
    const hits = list.reduce((x, a) => x + a.hits, 0);
    out.push(row([name, list.length, pct(list.filter(a => a.landed).length, list.length), pct(list.filter(a => a.hits > 0).length, list.length),
      list.length ? (hits / list.length).toFixed(1) : '-', pct(list.filter(a => a.won).length, list.length), pct(list.filter(a => a.lost).length, list.length)]));
  }
};
out.push(`# Boelcke's rules in ${rows.length} recorded fights\n`);
attackTable('Rule 1: the advantage going in', [
  ['With the advantage', attacks.filter(a => a.advantage)],
  ['  by energy (50 m or more)', attacks.filter(a => a.lead >= DOCTRINE.advantage)],
  ['  unseen', attacks.filter(a => a.unseen)],
  ['Without it', attacks.filter(a => !a.advantage)],
  ['  from below them (100 m)', attacks.filter(a => a.above <= -100)],
]);
if (attacks.some(a => Number.isFinite(a.sun))) {
  const sunned = attacks.filter(a => Number.isFinite(a.sun));
  attackTable('Rule 1: out of the sun (the levels with a sun)', [
    ['Within 20 degrees of the sun', sunned.filter(a => a.sun <= 20)],
    ['20 to 45', sunned.filter(a => a.sun > 20 && a.sun <= 45)],
    ['Elsewhere', sunned.filter(a => a.sun > 45)],
  ]);
  const near = sunned.filter(a => a.sun <= 20), far = sunned.filter(a => a.sun > 45);
  out.push(`\nUnseen at the start: ${pct(near.filter(a => a.unseen).length, near.length)} from the sun, ${pct(far.filter(a => a.unseen).length, far.length)} elsewhere (the school's eyes, which do not model the sun).`);
}
attackTable('Rule 2: carried through or abandoned', [
  ['Carried through (a shot that would land)', attacks.filter(a => a.finished)],
  ['Spoiled (they turned to face it)', attacks.filter(a => !a.landed && a.met)],
  ['Threatened (their nose on you)', attacks.filter(a => !a.landed && !a.met && a.threatened)],
  ['Abandoned', attacks.filter(a => a.abandoned)],
]);
out.push('\n**Rule 3: rounds by range as they left**\n', row(['Range', 'Bursts', 'Rounds', 'Hits', 'Hits per 100 rounds']), row(['---', '---', '---', '---', '---']));
for (const [lo, hi] of [[0, 100], [100, 200], [200, 300], [300, 400], [400, 700], [700, Infinity]]) {
  const list = bursts.filter(b => b.range >= lo && b.range < hi);
  const rounds = list.reduce((x, b) => x + b.rounds, 0), hits = list.reduce((x, b) => x + b.hits, 0);
  out.push(row([`${lo}-${hi === Infinity ? '' : hi} m`, list.length, rounds, hits, rounds ? (100 * hits / rounds).toFixed(1) : '-']));
}
const won = sights.filter(s => s.won), lost = sights.filter(s => !s.won);
const mean = list => (list.length ? Math.round(100 * list.reduce((x, s) => x + s.sight, 0) / list.length) : '-');
out.push(`\n**Rule 4: sight** (the school's eyes run over the tracks): the winner had the other in sight ${mean(won)}% of the fight on average, the loser ${mean(lost)}% (${won.length} fights with a kill).`);
const firsts = attacks.filter(a => a.first);
attackTable('Rule 5: where the first burst came from', [
  ['Within 45 degrees of their tail', firsts.filter(a => a.first.aspect <= 45)],
  ['45 to 90', firsts.filter(a => a.first.aspect > 45 && a.first.aspect <= 90)],
  ['Their front half', firsts.filter(a => a.first.aspect > 90)],
]);
out.push('\n**Rule 6: dived on from 100 m or more above**\n', row(['', 'Dives', 'Hit by it', 'Hits taken a dive', 'Won the fight', 'Lost it']), row(['---', '---', '---', '---', '---', '---']));
for (const [name, list] of [['Met it', dives.filter(d => d.met)], ['Ran', dives.filter(d => d.ran)], ['Neither', dives.filter(d => !d.met && !d.ran)]]) {
  const taken = list.reduce((x, d) => x + d.hitMe, 0);
  out.push(row([name, list.length, pct(list.filter(d => d.hitMe > 0).length, list.length), list.length ? (taken / list.length).toFixed(1) : '-',
    pct(list.filter(d => d.won).length, list.length), pct(list.filter(d => d.lost).length, list.length)]));
}
out.push(`\n**Rule 8: how the fights ended**: ${Object.entries(endings).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
console.log(out.join('\n'));
if (opt('json')) await writeFile(opt('json'), JSON.stringify({ fights: rows.length, attacks, dives, bursts: bursts.length, endings }, null, 1));
