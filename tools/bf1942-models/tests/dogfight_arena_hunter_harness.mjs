// The hunter on every arena (features/dogfight-doctrine, "The hunter on
// every arena"): the pair lesson's four demos flown with each arena's two
// planes, as the school page puts them up by default (yours its best Allied
// fighter, the hunter the other side's best), each on its own airframe and
// with its own gunners, as the theatre flies them. The airframes are the
// published node trees in `fixtures/arena-airframes.json.gz`
// (`surveys/airframe_fixture.py --qualified`), its `arenas` the pairs
// (`surveys/dogfight_arena_airframes.mjs`). Prints one JSON blob for
// `test_dogfight_arena_hunter.py`: `fits` by airframe, `pairs` by
// `<you>|<ace>`.
//
// `node dogfight_arena_hunter_harness.mjs [<you>|<ace> ...]` flies only
// those; with `MOVES=1` it also scores every lesson's moves from the nine
// starts (`dogfight-measure.js` `movesOn`), the counts the tabs show.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await load('vendor/three.module.js');
const { Aircraft } = await load('aircraft.js');
const { runDuel, fitAirframe, levelSpeed } = await load('dogfight-duel.js');
const { runFight } = await load('dogfight-fight.js');
const { LESSONS, demoSides, fightSides, withGunners, hasGunners } = await load('dogfight-lessons.js');
const { gunnersOf } = await load('dogfight-gunner-seats.js');
const { movesOn } = await load('dogfight-measure.js');
const { jetMaker, airframeTree } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);

const fixture = JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'fixtures', 'arena-airframes.json.gz'))).toString('utf8'));
const only = process.argv.slice(2);
const pairs = [...new Set(Object.values(fixture.arenas).flat().map(r => `${r.you}|${r.ace}`))].filter(k => !only.length || only.includes(k));

/** The pair's demos, flown as the theatre flies them. */
function pair(makePlane, gunnersFor, pace = 1) {
  const LP = LESSONS.find(l => l.id === 'the-pair');
  const out = {};
  for (const d of LP.demos) {
    const sides = fightSides(LP, d, null, gunnersFor);
    const r = d.extra || hasGunners(sides) ? runFight({ makePlane, seconds: d.seconds ?? LP.seconds, origin: [0, 0, 0], groundAt: () => 0, sides })
      : runDuel({ makePlane, seconds: d.seconds ?? LP.seconds, origin: [0, 0, 0], groundAt: () => 0, sides: sides.slice(0, 2) });
    const on = r.hitsOn ?? [r.hits[1], r.hits[0]];
    const downs = r.downs ?? (r.end ? [{ i: r.end.winner === 0 ? 1 : 0, t: r.end.t, why: r.end.why }] : []);
    // The hunter's pitch stick: how often it swings from one stop to the
    // other in a second, over its tracking (`track`) ticks.
    const track = r.tracks[0];
    let swings = 0, ticks = 0, last = 0;
    for (const k of track) {
      if (k.ph !== 'track' || !k.stick) continue;
      ticks++;
      const p = k.stick[1];
      const s = p > 0.9 ? 1 : p < -0.9 ? -1 : 0;
      if (s && last && s !== last) swings++;
      if (s) last = s;
    }
    out[d.id] = {
      youDown: downs.find(x => x.i === 1)?.t ?? null, youWhy: downs.find(x => x.i === 1)?.why ?? null,
      hunterDown: downs.find(x => x.i === 0)?.why ?? null, wingDown: downs.find(x => x.i === 2)?.why ?? null,
      onYou: on[1], onHunter: on[0], onWing: on[2] ?? null,
      firstShot: r.rounds.find(x => x.side === 0)?.t ?? null,
      // Where the theatre opens the demo: the hunter 280 m back (`startRange`),
      // at the airframe's pace.
      opens: d.startRange ? (track.find((k, j) => Math.hypot(...k.p.map((v, c) => v - r.tracks[1][j].p[c])) <= d.startRange * pace)?.t ?? 0) : (d.startAt ?? 0),
      swingsPerSecond: ticks ? Math.round(swings / (ticks / 30) * 100) / 100 : null,
      minHunterHeight: Math.round(Math.min(...track.map(k => k.p[1]))),
    };
  }
  return out;
}

const makers = new Map(), gunners = new Map();
const maker = name => { if (!makers.has(name)) makers.set(name, jetMaker(THREE, Aircraft, fixture, name)); return makers.get(name); };
const gunnersIn = name => { if (!gunners.has(name)) gunners.set(name, gunnersOf(airframeTree(THREE, fixture.airframes[name]))); return gunners.get(name); };
const out = { fits: {}, pairs: {} };
for (const key of pairs) {
  const [you, ace] = key.split('|');
  // Side 0 the hunter, the rest yours (you, your wingman), each its own type.
  const makePlane = (side, i) => (i === 0 ? maker(ace) : maker(you))();
  const gunnersFor = i => gunnersIn(i === 0 ? ace : you);
  for (const [name, i] of [[you, 1], [ace, 0]]) {
    if (out.fits[name]) continue;
    const fit = fitAirframe(makePlane(null, i), makePlane, i);
    out.fits[name] = { hand: fit.hand, pace: fit.pace, gunners: gunnersIn(name).length, level: Math.round(levelSpeed(makePlane(null, i)) * 10) / 10 };
  }
  out.pairs[key] = { pair: pair(makePlane, gunnersFor, Math.max(out.fits[ace].pace, out.fits[you].pace)) };
  if (process.env.MOVES) {
    const duel = opts => { const sides = withGunners(opts.sides, gunnersFor); return hasGunners(sides) ? runFight({ ...opts, sides }) : runDuel(opts); };
    out.pairs[key].moves = {};
    for (const L of LESSONS) {
      const m = await movesOn(L, { makePlane, runDuel: duel, demoSides });
      for (const [id, v] of Object.entries(m)) out.pairs[key].moves[`${L.id}/${id}`] = v.works;
    }
  }
}
console.log(JSON.stringify(out));
