// The pair lesson flown (features/dogfight-school, "Fly the pair"): the live
// fight's wingman under node. Its plain half (`viewer/dogfight-live-wing.js`):
// whom the hunter goes after, the wingman's pilot stepped with the fight
// handed to it, the end card's words; and the fight it flies, from the nine
// starts, with your hands on the stick as a test script puts them (flying
// straight, or turning hard) and your wingman flying the `wingman` plan
// beside you, on three arenas' own planes: Kursk's Bf 109 against the Yak 9,
// Kursk with the Stuka picked (its gunner firing), FHSW's El Alamein.
// Prints one JSON blob for `test_dogfight_live_wing.py`.

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
const { runFight } = await load('dogfight-fight.js');
const { fitAirframe } = await load('dogfight-duel.js');
const { LESSONS, fightSides } = await load('dogfight-lessons.js');
const { PLANS, createPilot } = await load('dogfight-pilot.js');
const { bankAndPull } = await load('dogfight-flight.js');
const { STARTS, nudge } = await load('dogfight-measure.js');
const { gunnersOf } = await load('dogfight-gunner-seats.js');
const W = await load('dogfight-live-wing.js');
const { jetMaker, airframeTree } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);

const arenaFx = JSON.parse(gunzipSync(readFileSync(path.join(HERE, 'fixtures', 'arena-airframes.json.gz'))).toString('utf8'));
const seaters = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'two-seaters.json'), 'utf8'));
const out = {};

// --- the plain half --------------------------------------------------------------
const at = (p, v = [0, 0, -60]) => ({ position: p, velocity: v, orientation: { x: 0, y: 0, z: 0, w: 1 }, angularVelocity: [0, 0, 0] });
out.target = {
  alone: W.huntTarget(1, at([0, 400, 300]), at([0, 400, 0]), null),
  wingNearer: W.huntTarget(null, at([0, 400, 300]), at([0, 400, 0]), at([0, 400, 200])),
  keptUnlessThirdNearer: W.huntTarget(1, at([0, 400, 300]), at([0, 400, 0]), at([0, 400, 80])),
  switched: W.huntTarget(1, at([0, 400, 300]), at([0, 400, 0]), at([0, 400, 150])),
};
out.words = Object.fromEntries(['station', 'rejoin', 'cover', 'shoot', 'down', 'nonsense'].map(p => [p, W.wingWords(p)]));
out.ends = {
  wingman: W.pairEnd({ how: 'ace', by: 'wingman', t: 31.2, wingOnAce: 22, wingEngaged: true }),
  you: W.pairEnd({ how: 'you', t: 24.6, onYou: 22, wingEngaged: true }),
  lonely: W.pairEnd({ how: 'you', t: 24.6, onYou: 22, wingDown: true, wingEngaged: true }),
  time: W.pairEnd({ how: 'time', t: 60.1, wingEngaged: true }),
};
{
  // The wingman's pilot handed the fight: a hunter 300 m behind you, the
  // wingman abeam. They break onto it.
  const make = jetMaker(THREE, Aircraft, arenaFx, 'bf1942:Spitfire');
  const fit = fitAirframe(make(), () => make());
  const pilot = createPilot('wingman', { skill: 0.85 });
  pilot.mem.leader = 1;
  const r = W.stepWing(pilot, fit, { me: at([-180, 400, 60]), you: at([0, 400, 0]), ace: at([60, 430, 300]), aceLevel: fit.level, dt: 1 / 30, t: 0, groundAt: () => 0 });
  out.stepWing = { phase: r.phase, says: r.say };
}

// --- the fight flown, from the nine starts --------------------------------------
// Your hands as the live fight's test script puts them (`script`): straight
// and level on your heading (the `cruiser`'s hands), or banked to 75 degrees
// and pulled.
PLANS.turnHard = { title: 'Turning hard', first: 'turn', says: { turn: 'Turning hard' }, step: c => ({ ...bankAndPull(c.me, 75, 0.9), throttle: 1, aimed: false }) };
const LP = LESSONS.find(l => l.id === 'the-pair');
const move = LP.demos.find(d => d.id === 'move');
const maker = (fx, name) => jetMaker(THREE, Aircraft, fx, name);
const ARENAS = {
  'kursk-bf109': { you: maker(arenaFx, 'bf1942:BF109'), ace: maker(arenaFx, 'bf1942:Yak9'), gunners: [] },
  'kursk-stuka': { you: maker(seaters, 'Stuka'), ace: maker(arenaFx, 'bf1942:Yak9'), gunners: gunnersOf(airframeTree(THREE, seaters.airframes.Stuka)) },
  'fhsw-el-alamein': { you: maker(arenaFx, 'fhsw:SpitfireIb'), ace: maker(arenaFx, 'fhsw:Bf109-F'), gunners: [] },
};
out.flown = {};
for (const [name, a] of Object.entries(ARENAS)) {
  out.flown[name] = {};
  for (const [hands, plan] of [['straight', 'cruiser'], ['turn', 'turnHard']]) {
    for (const wing of [true, false]) {
      const demo = { ...move, seat: plan, extra: wing ? LP.flyWith : undefined };
      const rows = STARTS.map(st => {
        const sides = fightSides(LP, demo, null, i => (i === 0 ? [] : a.gunners));
        sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
        const r = runFight({ makePlane: (s, i) => (i === 0 ? a.ace() : a.you()), seconds: LP.seconds, groundAt: () => 0, sides });
        const g = r.rounds.filter(x => x.gunner !== undefined && x.side === 1);
        return { youDown: r.downs.some(x => x.i === 1), hunterDown: r.downs.some(x => x.i === 0), wingDown: r.downs.some(x => x.i === 2),
                 onYou: r.hitsOn[1], gunnerRounds: g.length, gunnerHits: g.filter(x => x.hit).length,
                 crashed: r.downs.filter(x => x.why === 'flew into the ground').map(x => x.i) };
      });
      out.flown[name][`${hands}${wing ? '' : '-alone'}`] = {
        saved: rows.filter(r => !r.youDown).length, of: rows.length, hunterDown: rows.filter(r => r.hunterDown).length,
        wingDown: rows.filter(r => r.wingDown).length, gunnerRounds: rows.reduce((n, r) => n + r.gunnerRounds, 0),
        gunnerHits: rows.reduce((n, r) => n + r.gunnerHits, 0), crashed: rows.flatMap(r => r.crashed),
      };
    }
  }
}
console.log(JSON.stringify(out));
