// Boelcke's rules over a recorded fight (`viewer/dogfight-doctrine.js` on
// `dogfight-recorded.js`'s reading of an extracted fight), where nobody's
// eyes were recorded and `perceive` runs over the tracks. A fight in the
// extractor's own shape (`dogfight-detect.js` `sampleFight`): the hunter
// 200 m dead astern of his prey, both flying straight at 60 m/s, firing for
// two seconds from 2 s in. Prints both sides' measures.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const { recordedFight } = await import(pathToFileURL(path.join(viewer, 'dogfight-recorded.js')).href);
const { doctrineOf } = await import(pathToFileURL(path.join(viewer, 'dogfight-doctrine.js')).href);

const DT = 0.1, N = 81, V = 60, Y = 500, GAP = 200;
// Recorded frame: the identity rotation's nose is +z.
const side = (name, z0) => ({
  name, tmpl: 'Spitfire', aimed: 0, turned: 0, lost: [],
  p: Array.from({ length: N }, (_, i) => [0, Y, z0 + V * i * DT]).flat(),
  q: Array.from({ length: N }, () => [0, 0, 0, 1]).flat(),
  rv: Array.from({ length: N }, () => 1),
});
const shots = [];
for (let t = 2; t < 4 - 1e-9; t += DT) shots.push({ side: 0, t: Math.round(t * 1000) / 1000, pos: [0, Y, V * t + 2], dir: [0, 0, 1], pv: [0, 0, V], weapon: 'SpitfireGuns' });
const raw = {
  id: 'doctrine-1', meta: {}, dt: DT, t0: 0, duration: (N - 1) * DT, kind: 'bounce', mutual: false, closest: GAP,
  kill: null, end: { why: 'quiet', t: 8, since: 4 }, evidence: [], sides: [side('Hunter', 0), side('Prey', GAP)], shots,
};
const fight = recordedFight(raw);
const doc = doctrineOf(fight, { guns: [{ range: 268 }, { range: 268 }] });
console.log(JSON.stringify(doc.sides.map(s => ({
  sight: s.sight, useful: s.useful,
  attacks: s.attacks.map(a => ({ t0: a.t0, unseen: a.unseen, advantage: a.advantage, aspect: a.aspect, first: a.first, hits: a.hits, landed: a.landed })),
  bursts: s.bursts.map(b => ({ t0: b.t0, rounds: b.rounds, closeRounds: b.closeRounds, hits: b.hits, range: b.range })),
  rules: s.rules.map(r => ({ n: r.n, kept: r.kept })),
}))));
