// A replay's shot lines (replay-shotlines.js, the game's game.drawDebug),
// under node. A server recording's collisions (`i`) and a client recording's
// rounds (`f`) with the rebuild's verdicts and the page's own impact records.
// One JSON report on stdout, read by test_replay_shotlines.py.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, recording, { ReplayShotLines, SHOT_LINE_LIFE }] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-recording.js'), imp('replay-shotlines.js'),
]);

const line = o => JSON.stringify(o);
const playerOf = (rec, verdicts = new Map()) => ({
  rec, time: 0, hulls: new Map(), shotMuzzles: new WeakMap(), shotVerdicts: () => verdicts,
  ctx: { scene: new THREE.Scene(), guns: { hits: [] } },
});
const results = {};

// A server recording: two collisions, one that did damage.
{
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 30, plus: 'server-replay-recorder/3' }),
    line({ k: 'i', t: 2, pid: 1, tid: 9, tmpl: 'Mp40', o: [1, 2, 3], p: [11, 2, 3], obj: 40, dmg: 1 }),
    line({ k: 'i', t: 2.5, pid: 1, tid: 9, tmpl: 'Mp40', o: [1, 2, 3], p: [1, 2, 53], obj: -1, dmg: 0 }),
    line({ k: 'end', t: 10 }),
  ].join('\n'));
  const p = playerOf(rec);
  const lines = new ReplayShotLines(p);
  lines.setOn(true);
  lines.update(1);
  lines.update(3);
  results.server = lines.lines.map(l => ({ a: l.a, b: l.b, hit: l.hit }));
  results.serverDrawn = lines.mesh.geometry.drawRange.count;
  lines.update(3 + SHOT_LINE_LIFE);
  results.serverFaded = lines.lines.length;
  // A seek back to before them: gone, and drawn again from there.
  lines.clear();
  lines.update(2.6);
  results.serverAfterSeek = lines.lines.length;
}

// A client recording: a hit the rebuild placed, a miss the page's round
// ended, and an impact of some other round, which draws nothing.
{
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'f', t: 1, id: 10, pid: 3, w: 'Mp40', p: [0, 1.6, 0], d: [0, 0, 1] }),
    line({ k: 'f', t: 1.5, id: 10, pid: 3, w: 'Mp40', p: [0, 1.6, 0], d: [1, 0, 0] }),
    line({ k: 'end', t: 10 }),
  ].join('\n'));
  const [hitF, missF] = rec.fires;
  const verdicts = new Map([[hitF, { hit: true, point: [0, 1.6, 30] }], [missF, { hit: false, point: null }]]);
  const p = playerOf(rec, verdicts);
  const lines = new ReplayShotLines(p);
  lines.setOn(true);
  lines.update(0.5);
  lines.update(1.6);
  const firstCount = lines.lines.length;
  // The page's rounds strike: the miss's along +X (page +X), and one down
  // some other line entirely.
  p.ctx.guns.hits.unshift({ firerGroup: { replay: true }, origin: [0, 1.6, 0], point: [0, 9, -40] });
  p.ctx.guns.hits.unshift({ firerGroup: { replay: true }, origin: [0, 1.6, 0], point: [25, 1.6, 0] });
  // Once fired, the hit's line starts at the drawn gun's muzzle.
  p.shotMuzzles.set(hitF, [0.1, 1.5, -0.7]);
  lines.update(1.8);
  results.client = {
    firstCount,
    lines: lines.lines.map(l => ({ a: l.a, b: l.b, hit: l.hit, muzzle: l.muzzle })),
  };
}

console.log(JSON.stringify(results));
