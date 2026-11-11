// The hunter on every arena's airframe (features/dogfight-doctrine, "The
// hunter on every arena"): the pair lesson's four demos flown on the
// airframe each arena of each tree flies its lessons on (its best fighter),
// as the theatre flies them. The airframes are the published node trees in
// `fixtures/arena-airframes.json.gz` (`surveys/airframe_fixture.py
// --qualified`). Prints one JSON blob for `test_dogfight_arena_hunter.py`.
//
// `node dogfight_arena_hunter_harness.mjs [airframe ...]` flies only those;
// with `MOVES=1` it also scores every lesson's moves from the nine starts on
// each (`dogfight-measure.js` `movesOn`), the counts the tabs show.

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
const { runDuel, fitAirframe } = await load('dogfight-duel.js');
const { runFight } = await load('dogfight-fight.js');
const { LESSONS, demoSides, fightSides, demoById } = await load('dogfight-lessons.js');
const { movesOn } = await load('dogfight-measure.js');
const { jetMaker } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);

const fixture = JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'fixtures', 'arena-airframes.json.gz'))).toString('utf8'));
const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(fixture.airframes);

/** The pair's demos, flown as the theatre flies them. */
function pair(makePlane) {
  const LP = LESSONS.find(l => l.id === 'the-pair');
  const out = {};
  for (const d of LP.demos) {
    const sides = fightSides(LP, d);
    const r = d.extra ? runFight({ makePlane, seconds: d.seconds ?? LP.seconds, origin: [0, 0, 0], groundAt: () => 0, sides })
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
      swingsPerSecond: ticks ? Math.round(swings / (ticks / 30) * 100) / 100 : null,
      minHunterHeight: Math.round(Math.min(...track.map(k => k.p[1]))),
    };
  }
  return out;
}

const out = {};
for (const name of names) {
  const make = jetMaker(THREE, Aircraft, fixture, name);
  const makePlane = () => make();
  const fit = fitAirframe(make(), makePlane);
  out[name] = { fit: { hand: fit.hand, pace: fit.pace }, pair: pair(makePlane) };
  if (process.env.MOVES) {
    out[name].moves = {};
    for (const L of LESSONS) {
      const m = await movesOn(L, { makePlane, runDuel, demoSides });
      for (const [id, v] of Object.entries(m)) out[name].moves[`${L.id}/${id}`] = v.works;
    }
  }
}
console.log(JSON.stringify(out));
