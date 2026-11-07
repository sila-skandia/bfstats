// The arsenal's firing range (scripts/shorts-range.mjs): one gun cut out of
// a recording. One node run, one JSON report.
// watches: scripts/shorts-range.mjs

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { rangeRecording } = await import(pathToFileURL(path.join(repo, 'scripts/shorts-range.mjs')).href);

const L = [];
const line = o => L.push(JSON.stringify(o));
line({ k: 'h', v: 5, hz: 10 });
line({ k: 'e', t: 0, e: 'setLevel', level: 'bf1942/levels/x/', mode: 'conquest.con' });
line({ k: 'roster', t: 0, p: [[1, 1, 0, 'A', 0], [2, 2, 0, 'B', 0]] });
line({ k: 'e', t: 1, e: 'createObject', netId: 7, tmpl: 'Tiger', pos: [0, 0, 0], rot: [0, 0, 0] });
line({ k: 'e', t: 1, e: 'createObject', netId: 8, tmpl: 'Sherman', pos: [9, 0, 9], rot: [0, 0, 0] });
line({ k: 'o', t: 1, id: 7, tmpl: 'Tiger', team: 1 });
line({ k: 'o', t: 1, id: 8, tmpl: 'Sherman', team: 2 });
line({ k: 'jn', t: 1, o: [[7, 1, 'TigerTurret', 0, 1, 0], [8, 2, 'ShermanTurret', 0, 1, 0]] });
line({ k: 'p', t: 1, p: [[1, 1, 7, 7, 0, 0], [2, 2, 8, 8, 0, 0]] });
for (let t = 1; t <= 40; t += 1) {
  line({ k: 's', t, o: [[7, t, 0, 0, 0, 0, 0, 1], [8, 9, 0, 9, 0, 0, 0, 1]] });
  line({ k: 'j', t, o: [[7, 1, 0, 0, 0, 1], [8, 2, 0, 0, 0, 1]] });
}
line({ k: 'f', t: 20, id: 7, pid: 1, w: 'TigerCoax', p: [0, 2, 0], d: [1, 0, 0] });
line({ k: 'f', t: 21, id: 7, pid: 1, w: 'TigerCannon', p: [0, 2, 0], d: [1, 0, 0] });
line({ k: 'f', t: 22, id: 8, pid: 2, w: 'ShermanCoax', p: [9, 2, 9], d: [-1, 0, 0] });
line({ k: 'f', t: 35, id: 7, pid: 1, w: 'TigerCoax', p: [0, 2, 0], d: [1, 0, 0] });
line({ k: 'e', t: 23, e: 'score', kind: 3, pid: 1, victim: 2 });
line({ k: 'chat', t: 24, pid: 1, text: 'gg' });

const out = rangeRecording(L.join('\n'), [{ id: 7, weapons: ['TigerCoax'], from: 19, to: 24 }]).trim().split('\n').map(l => JSON.parse(l));
const kinds = {};
for (const o of out) kinds[o.k] = (kinds[o.k] ?? 0) + 1;
console.log(JSON.stringify({
  kinds,
  objects: [...new Set(out.flatMap(o => (o.k === 'e' && o.netId !== undefined ? [o.netId] : o.k === 'o' ? [o.id] : (Array.isArray(o.o) ? o.o.map(r => r[0]) : []))))],
  shots: out.filter(o => o.k === 'f').map(o => [o.t, o.w]),
  samples: out.filter(o => o.k === 's').map(o => o.t),
  roster: out.find(o => o.k === 'roster')?.p,
  end: out.at(-1),
}));
