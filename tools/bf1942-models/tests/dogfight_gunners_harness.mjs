// A two-seater's gunner in a recorded fight (features/dogfight-recordings,
// "The gunners' rounds"): El Alamein, 2026-10-04, a Yak 9 on a Stuka's tail
// while the Stuka's rear gunner fires back (`fixtures/gunner_stuka_558jj8m4nb
// .ndjson.gz`, 1195 to 1240 s of recording 558jj8m4nb, cut with
// `recording-slice.js`). Read with the viewer's own reader, found with the
// detector, sampled and turned into the theatre's fight, its tracers picked;
// and the Stuka's gunner read off its own model (`fixtures/two-seaters.json`).
// Prints one JSON blob for `test_dogfight_gunners.py`.

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
const { parseRecording } = await load('replay-recording.js');
const D = await load('dogfight-detect.js');
const { recordedFight } = await load('dogfight-recorded.js');
const { tracerRounds, isGunnerRound } = await load('dogfight-plane-look.js');
const { gunnersOf } = await load('dogfight-gunner-seats.js');
const { airframeTree } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);

const text = gunzipSync(readFileSync(path.join(HERE, 'fixtures', 'gunner_stuka_558jj8m4nb.ndjson.gz'))).toString('utf8');
const rec = parseRecording(text);
const air = tmpl => (/^(yak9|stuka|bf109|spitfire|zero|aichival|ilyushin|mustang)$/i.test(String(tmpl)) ? true : null);
const fights = D.findDogfights(rec, D.RULES, { air });
const out = { fights: [] };
for (const fight of fights) {
  const raw = D.sampleFight(rec, fight);
  const tmpls = raw.sides.map(s => s.tmpl);
  const gunner = raw.shots.filter(s => s.gunner);
  const row = { tmpls, shots: raw.shots.length, gunner: gunner.length, gunnerSides: [...new Set(gunner.map(s => s.side))],
                gunnerWeapons: [...new Set(gunner.map(s => s.weapon))], pilotShotsBySide: [0, 1].map(s => raw.shots.filter(x => x.side === s && !x.gunner).length) };
  if (gunner.length) {
    const f = recordedFight({ ...raw, id: 'test' });
    const rounds = f.rounds.filter(isGunnerRound);
    const side = rounds[0].side;
    // The theatre's look for the gunner's gun: interval 2, as MG42_Air's
    // own tracer (`tracerGunOf`); the pilot's guns a vanilla MG's.
    const look = { rate: 12, interval: 2 };
    const set = tracerRounds(f.rounds, [{ rate: 12, interval: 3 }, { rate: 12, interval: 3 }], () => look);
    row.recorded = {
      gunnerRounds: rounds.length, side, dirs: rounds.every(r => r.dir && Math.abs(Math.hypot(...r.dir) - 1) < 1e-6),
      gunnerTracers: [...set].filter(isGunnerRound).length,
      // The gunner firing is not the pilot firing: the Stuka's track
      // carries its pilot's trigger only.
      pilotFiringTicks: f.tracks[side].filter(k => k.f).length,
    };
  }
  out.fights.push(row);
}
const seaters = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'two-seaters.json'), 'utf8'));
out.stukaGun = gunnersOf(airframeTree(THREE, seaters.airframes.Stuka)).map(g => g.weapon);
console.log(JSON.stringify(out));
