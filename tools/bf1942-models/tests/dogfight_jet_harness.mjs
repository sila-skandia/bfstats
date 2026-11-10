// The dogfight school's lessons flown on Desert Combat's jets
// (features/dogfight-lessons-jets), on the published airframes in
// `fixtures/dc-jets.json` and the viewer's own modules, loaded in place.
//
//   node tests/dogfight_jet_harness.mjs --fit
//       what `fitAirframe` makes of each jet: its hand, pace and cannon
//   node tests/dogfight_jet_harness.mjs <lesson> [--plane Mig29] [--demo <id>] [--seconds n] [--base]
//       each demo of the lesson's jet version from the nine starts, as JSON:
//       the school harness's run records, and where the fight ended
//   node tests/dogfight_jet_harness.mjs <lesson> --trace <demo> [--step 2] [--start 4]
//       one fight's timeline as text (start 0..8 of the nine; 4 is the
//       lesson's own), every `step` seconds, then each side's phases
//
// `--base` flies the lesson as written (no jet file); `--text` prints the
// nine starts a line a demo, to read instead of parse.
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
const { runDuel, fitAirframe, pilotView, paced, PACE } = await load('dogfight-duel.js');
const { runFight } = await load('dogfight-fight.js');
const { LESSONS, lessonFor, demoSides, fightSides, demoById } = await load('dogfight-lessons.js');
const { HAND } = await load('dogfight-flight.js');
const { jetMaker } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'dc-jets.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const r1 = v => Math.round(v * 10) / 10;

if (flag('--fit')) {
  const out = {};
  for (const name of Object.keys(fixture.airframes)) {
    const make = jetMaker(THREE, Aircraft, fixture, name);
    out[name] = fitAirframe(make(), make);
  }
  const view = pilotView(1.28);
  console.log(JSON.stringify({ fits: out, hand: HAND, pace: PACE,
    paced: paced({ at: [-350, 680, 300], headingDeg: 0, speed: 58 }, 1.28), unpaced: paced({ at: [1, 2, 3], speed: 50 }, 1),
    view: { see: view.see({ position: [128, 256, -64], velocity: [0, 0, -128], orientation: { x: 0, y: 0, z: 0, w: 1 }, angularVelocity: [1, 2, 3] }),
            gun: view.gun({ speed: 1000, reach: 5000 }), arena: view.arena({ centre: [128, 0], radius: 1280 }), ground: view.ground((x, z) => x + z)(100, 28) },
    same: pilotView(1).see === pilotView(1).see ? null : pilotView(1).see('x') }));
  process.exit(0);
}

const lessonId = args.find(a => !a.startsWith('--') && a !== opt('--plane') && a !== opt('--demo') && a !== opt('--seconds') && a !== opt('--trace') && a !== opt('--step') && a !== opt('--start'));
const base = LESSONS.find(l => l.id === lessonId);
if (!base) { console.error(`no lesson ${lessonId}: ${LESSONS.map(l => l.id).join(', ')}`); process.exit(2); }
const L = flag('--base') ? base : lessonFor(base, 'jet');
const makePlane = jetMaker(THREE, Aircraft, fixture, opt('--plane', 'F16'));
const STARTS = [];
for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) STARTS.push({ dx, dv });

/** One fight of `demo` from start `n` of the nine. */
function fly(demo, n) {
  const { dx, dv } = STARTS[n];
  const seconds = Number(opt('--seconds', demo.seconds ?? L.seconds));
  if (demo.extra || demo.wing) return runFight({ makePlane, seconds, groundAt: () => 0, sides: fightSides(L, demo) });
  const sides = demoSides(L, demo);
  sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
  return runDuel({ makePlane, seconds, groundAt: () => 0, sides });
}
const sepAt = (r, i) => Math.hypot(...r.tracks[0][i].p.map((v, j) => v - r.tracks[1][i].p[j]));

if (opt('--trace')) {
  const demo = demoById(L, opt('--trace')) ?? L.demos.find(d => d.id === opt('--trace'));
  const r = fly(demo, Number(opt('--start', 4)));
  const [A, B] = r.tracks, n = Math.min(A.length, B.length), every = Math.round(Number(opt('--step', 2)) / r.dt);
  const sides = demoSides(L, demo);
  console.log(`${L.id}/${demo.id} on the ${opt('--plane', 'F16')}: ace ${sides[0].plan} ${JSON.stringify(sides[0].memory ?? {})} | you ${sides[1].plan} ${JSON.stringify(sides[1].memory ?? {})} | fit ${JSON.stringify(r.fits?.[0])}`);
  for (let i = 0; i < n; i += every) {
    const fired = (T, k) => T.slice(Math.max(0, i - every + 1), i + 1).filter(x => x[k]).length;
    const row = (T, tag) => `${tag} ${String(T[i].ph).padEnd(9)} v ${String(Math.round(T[i].v)).padStart(3)} y ${String(Math.round(T[i].p[1])).padStart(4)} off ${String(T[i].so).padStart(5)} fire/hit ${fired(T, 'f')}/${fired(T, 'h')}`;
    console.log(`${String(A[i].t.toFixed(0)).padStart(3)}s sep ${String(Math.round(sepAt(r, i))).padStart(4)} | ${row(A, 'ACE')} | ${row(B, 'YOU')}`);
  }
  console.log(`end ${JSON.stringify(r.end)} hits ace ${r.hits?.[0]} you ${r.hits?.[1]}`);
  for (const s of [0, 1]) console.log(`${s ? 'you' : 'ace'}: ${r.events.filter(e => e.side === s).map(e => `${e.t.toFixed(1)} ${e.phase}`).join(', ')}`);
  process.exit(0);
}

// One demo by its id (a retired one too, which the stories still quote), or all.
const demos = opt('--demo') ? [L.demos.find(d => d.id === opt('--demo')) ?? demoById(L, opt('--demo'))].filter(Boolean) : L.demos;
const out = { lesson: L.id, plane: opt('--plane', 'F16'), era: L.era ?? null, demos: {} };
for (const demo of demos) {
  const runs = [];
  for (let n = 0; n < STARTS.length; n++) {
    const r = fly(demo, n);
    if (!r.hits || r.tracks.length !== 2) { runs.push({ fight: true, end: r.end ?? null }); continue; }
    const last = Math.min(r.tracks[0].length, r.tracks[1].length) - 1;
    let closest = Infinity;
    for (let i = 0; i <= last; i += 3) closest = Math.min(closest, sepAt(r, i));
    runs.push({
      winner: r.end ? r.end.winner : null, why: r.end?.why ?? null, t: r.end ? r1(r.end.t) : null, hits: r.hits,
      // Each side's energy lead at the end (yours less theirs, metres), the
      // seconds each had a shot that would land, and the phases each flew.
      lead: Math.round(r.tracks[1].at(-1).e - r.tracks[0].at(-1).e),
      shots: r.tracks.map(tr => r1(tr.filter(k => k.o).length * r.dt)),
      phases: [0, 1].map(i => [...new Set(r.events.filter(e => e.side === i && e.phase !== 'kill').map(e => e.phase))]),
      // Where it ended: how far apart, the closest they came, each one's
      // height and speed, and the height you gained.
      apart: Math.round(sepAt(r, last)), closest: Math.round(closest),
      height: r.tracks.map(tr => Math.round(tr[last].p[1])), speed: r.tracks.map(tr => Math.round(tr[last].v)),
      climbed: Math.round(r.tracks[1][last].p[1] - r.tracks[1][0].p[1]),
    });
  }
  out.demos[demo.id] = runs;
}
if (flag('--text')) {
  for (const [id, runs] of Object.entries(out.demos)) {
    console.log(`${L.id}/${id}`.padEnd(30), runs.map(x => (x.fight ? JSON.stringify(x.end) : `${x.winner === null ? '-' : (x.winner ? 'YOU' : 'ACE') + '@' + Math.round(x.t) + (x.why === 'shot down' ? '' : '(' + x.why + ')')} ${x.hits.join('/')}`)).join(' | '));
  }
} else console.log(JSON.stringify(out));
