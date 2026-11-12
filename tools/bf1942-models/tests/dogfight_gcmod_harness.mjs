// Galactic Conquest's lessons (`viewer/dogfight-lessons/gcmod/index.js`),
// flown from the school's nine starts on the published airframes of
// `fixtures/gc-starfighters.json`: the ace on the lesson's `ace.craft`
// (default the TIE fighter), you on `you.craft` (default the X-Wing).
//
//   node tests/dogfight_gcmod_harness.mjs [<lesson>] [--demo <id>] [--text]
//   node tests/dogfight_gcmod_harness.mjs <lesson> --trace <demo> [--start 4] [--step 1]
//
// JSON by default: each demo's nine runs (the winner, how and when, each
// side's hits, the closest the two came, the seconds each had a shot that
// would land, and the phases each flew).
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await load('vendor/three.module.js');
const { Aircraft } = await load('aircraft.js');
const { runDuel } = await load('dogfight-duel.js');
const { demoSides } = await load('dogfight-lessons.js');
const { GC_LESSONS } = await load('dogfight-lessons/gcmod/index.js');
const { jetMaker } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'gc-starfighters.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const r1 = v => Math.round(v * 10) / 10;
const STARTS = [];
for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) STARTS.push({ dx, dv });

const makers = {};
const maker = name => (makers[name] ??= jetMaker(THREE, Aircraft, fixture, name));

/** One fight of `demo` of `L` from start `n` of the nine. */
export function fly(L, demo, n, seconds = demo.seconds ?? L.seconds) {
  const { dx, dv } = STARTS[n];
  const sides = demoSides(L, demo);
  sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
  const crafts = [L.ace.craft ?? 'tiefighter', L.you.craft ?? 'X-Wing'];
  return runDuel({ makePlane: (_, i) => maker(crafts[i])(), seconds, groundAt: () => 0, sides });
}

const sep = (r, i) => Math.hypot(...r.tracks[0][i].p.map((v, j) => v - r.tracks[1][i].p[j]));

function summary(r) {
  const last = Math.min(r.tracks[0].length, r.tracks[1].length) - 1;
  let closest = Infinity, closestAt = 0;
  for (let i = 0; i <= last; i++) { const d = sep(r, i); if (d < closest) { closest = d; closestAt = r.tracks[0][i].t; } }
  // The first moment the ace is in front of you (it overshot), if ever.
  let passed = null;
  for (let i = 0; i <= last && passed === null; i++) {
    const me = r.tracks[1][i], him = r.tracks[0][i];
    const q = me.q, fw = [-2 * (q[0] * q[2] + q[3] * q[1]), -2 * (q[1] * q[2] - q[3] * q[0]), -(1 - 2 * (q[0] * q[0] + q[1] * q[1]))];
    const rel = him.p.map((v, j) => v - me.p[j]);
    if (fw[0] * rel[0] + fw[1] * rel[1] + fw[2] * rel[2] > 0 && i > 0) passed = r1(me.t);
  }
  return {
    winner: r.end ? (r.end.winner ? 'you' : 'ace') : null, why: r.end?.why ?? null, t: r.end ? r1(r.end.t) : null,
    hits: r.hits, closest: Math.round(closest), closestAt: r1(closestAt), passed,
    shots: r.tracks.map(tr => r1(tr.filter(k => k.o).length * r.dt)),
    minSpeed: r.tracks.map(tr => Math.round(Math.min(...tr.map(k => k.v)))),
    phases: [0, 1].map(i => [...new Set(r.events.filter(e => e.side === i && e.phase !== 'kill').map(e => e.phase))]),
    apart: Math.round(sep(r, last)),
  };
}

const lessons = args[0] && !args[0].startsWith('--') ? GC_LESSONS.filter(l => l.id === args[0]) : GC_LESSONS;
if (opt('--trace')) {
  const L = lessons[0];
  const demo = L.demos.find(d => d.id === opt('--trace'));
  const r = fly(L, demo, Number(opt('--start', 4)));
  const every = Math.round(Number(opt('--step', 1)) / r.dt);
  for (let i = 0; i < r.tracks[0].length; i += every) {
    const a = r.tracks[0][i], b = r.tracks[1][i];
    if (!b) break;
    console.log(`${r1(a.t)}s  ace ${a.ph} v${Math.round(a.v)} y${Math.round(a.p[1])}${a.f ? ' FIRE' : ''} | you ${b.ph} v${Math.round(b.v)} y${Math.round(b.p[1])} thr${r1(b.stick[3])}${b.f ? ' FIRE' : ''} | ${Math.round(sep(r, i))} m`);
  }
  console.log(JSON.stringify({ end: r.end, hits: r.hits }));
  process.exit(0);
}
const out = {};
for (const L of lessons) {
  out[L.id] = {};
  for (const demo of L.demos) {
    if (opt('--demo') && demo.id !== opt('--demo')) continue;
    out[L.id][demo.id] = STARTS.map((_, n) => summary(fly(L, demo, n)));
  }
}
if (flag('--text')) {
  for (const [id, demos] of Object.entries(out)) for (const [d, runs] of Object.entries(demos)) {
    console.log(`${id}/${d}`.padEnd(32), runs.map(x => `${x.winner ?? '-'}${x.t !== null ? '@' + Math.round(x.t) : ''} ${x.hits.join('/')} c${x.closest}${x.passed !== null ? ' p' + Math.round(x.passed) : ''}`).join(' | '));
  }
} else console.log(JSON.stringify(out));
