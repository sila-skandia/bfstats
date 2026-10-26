// Writes core/src/test/resources/parity/live-snapshot.json: live-snapshot.mjs
// fed the repo's recorded sessions (tests/fixtures, which the Kotlin test
// reads from the same paths), with the snapshot at twelve cuts through each
// (its sha-256 and length; the whole of it for the round-restart session),
// and the cases of sidecar_join_state_harness.mjs that the recordings do not
// carry, snapshot by snapshot.
//   node parity/live-snapshot.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createLiveState } from '../../bf1942-models/sidecar/live-snapshot.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = ['sidecar_wake_round_restart.ndjson.gz', 'sidecar_midway_join.ndjson.gz', 'sidecar_midway_bodies_twice.ndjson.gz'];
const sha = (lines) => crypto.createHash('sha256').update(lines.join('\n')).digest('hex');

const recordings = [];
for (const name of FIXTURES) {
  const text = zlib.gunzipSync(fs.readFileSync(path.join(here, '../../bf1942-models/tests/fixtures', name))).toString('utf8');
  const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const end = rows.reduce((m, r) => (Number.isFinite(r.t) && r.t > m ? r.t : m), 0);
  const cuts = Array.from({ length: 12 }, (_, i) => +(((i + 1) / 13) * end).toFixed(2));
  const L = createLiveState();
  const snaps = [];
  let ci = 0, n = 0;
  const check = (cut) => {
    const s = L.liveSnapshot();
    snaps.push({ cut, rows: n, lines: s.length, sha: sha(s), ...(name === FIXTURES[0] && snaps.length === 6 ? { full: s } : {}) });
  };
  for (const r of rows) {
    while (ci < cuts.length && (r.t ?? 0) > cuts[ci]) check(cuts[ci++]);
    L.remember(r);
    n++;
  }
  while (ci < cuts.length) check(cuts[ci++]);
  const s = L.liveSnapshot();
  snaps.push({ cut: 'end', rows: n, lines: s.length, sha: sha(s) });
  recordings.push({ file: name, snaps });
}

// sidecar_join_state_harness.mjs's cases, and more of the edges remember() has.
const base = [
  { k: 'h', t: 0, v: 3, level: 'wake' },
  { k: 'anim', t: 0, names: ['stand', 'crouch'] },
  { k: 'e', t: 0, e: 'serverInfo', mod: 'bf1942' },
  { k: 'e', t: 0, e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'coop.con', nameTags: [100, 300] },
  { k: 'e', t: 1, e: 'createObject', tid: 1976, netId: 529, tmpl: 'B17', pos: [1, 2, 3], rot: [0, 0, 0], cls: 'SimpleObjectNetworkable' },
  { k: 'e', t: 1, e: 'createObject', tid: 1754, netId: 900, tmpl: 'USMarineSoldier', pos: [5, 6, 7], rot: [0, 0, 0] },
  { k: 'e', t: 1, e: 'createObject', tid: 1524, netId: 901, tmpl: 'UsMarine_Assault', pos: [5, 6, 7], rot: [0, 0, 0] },
  { k: 'e', t: 1, e: 'createPlayer', pid: 7, name: 'Bot', team: 2, ai: 1, netId: 400, vehNetId: 900, camNetId: 401, kitNetId: 901 },
  { k: 'e', t: 1, e: 'pickupKit', pid: 7, netId: 901 },
  { k: 'o', t: 1.1, id: 529, tid: 1976, tmpl: 'B17', team: 0, cls: 'SimpleObjectNetworkable' },
  { k: 'o', t: 1.1, id: 900, tid: 1754, tmpl: 'USMarineSoldier', team: 2, cls: 'BFSoldierNetworkable' },
  { k: 'o', t: 1.1, id: 901, tid: 1524, tmpl: 'UsMarine_Assault', team: 0, cls: 'KitNetworkable' },
  { k: 'g', t: 1.2, o: [[529, 0.77, 1, 1, 0, 0], [529, 0.771, 1, 1, 0, 1], [529, 0.629, 1, 1, 0, 2], [529, 0.629, 1, 1, 0, 3], [529, 0.5, 1, 1, 0]] },
  { k: 'a', t: 1.2, a: [[529, 160]] },
  { k: 'st', t: 1.2, o: [[900, 3, 1]] },
  { k: 'j', t: 1.2, o: [[529, 'turret', [0, 0, 0, 1]], [529, 'gun', [0, 0, 0, 1]]] },
  { k: 'j', t: 1.3, o: [[529, 'turret', [0, 0.1, 0, 1]]] },
  { k: 'jn', t: 1.3, o: [[529, 'turret', 3]] },
  { k: 's', t: 1.2, tick: 10, o: [[529, 1, 2, 3, 0, 0, 0, 1], [900, 5, 7, 7, 0, 0, 0, 1]] },
  { k: 'ps', t: 1.3, pid: 7, score: 3 },
  { k: 'ps', t: 1.3, pid: 'x', score: 3 },
  { k: 'tk', t: 1.4, a: 100, b: 90 },
  { k: 'win', t: 1.5, team: 1 },
  { k: 'f', t: 1.6, id: 1 },
  { k: 'd', t: 2, id: 529 },
  { k: 'd', t: 2, id: 12345 },
  { k: 'e', t: 3, e: 'enterVehicle', pid: 7, netId: 529 },
  { k: 'e', t: 3, e: 'score', kind: 4, pid: 7 },
  { k: 'e', t: 3, e: 'control', pid: 7, netId: 401 },
  { k: 'e', t: 3.5, e: 'score', kind: 5, pid: 7 },
  { k: 'e', t: 3.6, e: 'score', kind: 4, pid: 8 },
  { k: 'e', t: 4, e: 'destroyObject', netId: 901 },
  { k: 'e', t: 5, e: 'projPool', tid: 1281, tmpl: 'ExpPackProjectile', netId: 700, count: 9 },
  { k: 'e', t: 6, e: 'projPool', tid: 1288, tmpl: 'GrenadeAlliesProjectile', netId: 700, count: 3 },
  { k: 'e', t: 6, e: 'projPool', tid: 1288, tmpl: 'GrenadeAlliesProjectile', netId: 703, count: 20 },
  { k: 'e', t: 6, e: 'projPool', netId: 900, count: 1 },
  { k: 'e', t: 6.5, e: 'detonate', id: 702 },
  { k: 'e', t: 7, e: 'createStatic', tid: 55, tmpl: 'Crate', id: 3, pos: [1, 1, 1], rot: [0, 0, 0] },
  { k: 'e', t: 7, e: 'updateStatic', id: 3, action: 'move', value: [2, 2, 2] },
  { k: 'e', t: 7, e: 'updateStatic', id: 3, action: 'rotate', value: [0, 90, 0] },
  { k: 'e', t: 7, e: 'updateStatic', id: 3, action: 'scale', value: [2, 2, 2] },
  { k: 'e', t: 7, e: 'createStatic', tid: 55, tmpl: 'Crate', id: 4, pos: [1, 1, 1], rot: [0, 0, 0] },
  { k: 'e', t: 7, e: 'updateStatic', id: 4, action: 'delete' },
  { k: 'e', t: 8, e: 'gameStatus', status: 1 },
  { k: 'e', t: 8, e: 'cp', id: 515, team: 1 },
  { k: 'e', t: 8, e: 'setTeam', pid: 7, team: 1 },
  { k: 'e', t: 8, e: 'gameRules', ff: 0.5 },
  { k: 'e', t: 8, e: 'clock', limit: 0 },
  { k: 'e', t: 8, e: 'spawnGroups', groups: [] },
  { k: 'e', t: 8, e: 'hud', text: 'history' },
];
const stages = [
  base,
  [{ k: 'e', t: 9, e: 'gameStatus', status: 3 }, { k: 'e', t: 9.5, e: 'gameStatus', status: 1 }, { k: 'e', t: 9.6, e: 'cp', id: 516, team: 2 }],
  [{ k: 'e', t: 12, e: 'destroyObject', netId: 900 }, { k: 'e', t: 12, e: 'destroyObject', netId: 529 },
    { k: 'e', t: 13, e: 'createObject', tid: 1976, netId: 529, tmpl: 'B17', pos: [1, 2, 3], rot: [0, 0, 0], cls: 'SimpleObjectNetworkable' },
    { k: 'e', t: 13, e: 'exitVehicle', pid: 7 }],
  [{ k: 'e', t: 14, e: 'destroyPlayer', pid: 7 }, { k: 'e', t: 14, e: 'createObject', netId: 701, tid: 1, tmpl: 'Jeep' }],
  [{ k: 'e', t: 15, e: 'setLevel', level: 'bf1942/levels/midway/', mode: 'conquest.con' }],
];
const L = createLiveState();
const cases = stages.map((rows) => { for (const r of rows) L.remember(r); return { rows, snapshot: L.liveSnapshot() }; });

const out = { recordings, cases };
fs.writeFileSync(new URL('../core/src/test/resources/parity/live-snapshot.json', import.meta.url), JSON.stringify(out));
console.log(recordings.map((r) => `${r.file}: ${r.snaps.at(-1).lines} lines at the end`).join('\n'));
