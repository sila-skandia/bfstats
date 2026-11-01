// A replay's heals, flags and magazines from a server recording (viewer/
// replay-recording.js, replay-support.js, replay-ctf.js, replay-hud.js
// `recordedAmmoAt`; the server recorder's `heal`, `flagHolder` and `am`,
// features/replay-feature-sweep-2026-11-01 entries 13, 15 and 11). Parses a
// small server file and a client file, answers each at chosen times. Run by
// `tests/test_replay_support.py`; prints one JSON object.
//
//   node tests/replay_support_harness.mjs

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..', 'viewer');
const imp = name => import(pathToFileURL(path.join(VIEWER, name)).href);
const { parseRecording } = await imp('replay-recording.js');
const { supportAt, healsAt } = await imp('replay-support.js');
const { ctfStateAt } = await imp('replay-ctf.js');
const { recordedAmmoAt } = await imp('replay-hud.js');

const J = o => JSON.stringify(o);
const header = plus => J({ k: 'h', t: 0, v: 5, plus, start: 0, hz: 30 });
const player = (pid, name, team) => J({ k: 'e', t: 0, e: 'createPlayer', pid, name, team, ai: 1, netId: 0, vehNetId: 0 });
const server = parseRecording([
  header('server-replay-recorder/3'),
  J({ k: 'e', t: 0, e: 'setLevel', level: 'bf1942/levels/el_alamein/', mode: 'Ctf' }),
  player(5, 'Medic', 1), player(6, 'Patient', 1), player(7, 'Engineer', 2), player(8, 'Thief', 2),
  // 31: a medic on another (begun and ended), on himself, an engineer on a
  // hull, a depot on a soldier, and a visit the file never ended.
  J({ k: 'e', t: 10, e: 'heal', kind: 'medpack', pid: 5, to: 6, obj: 901 }),
  J({ k: 'e', t: 12.5, e: 'heal', kind: 'medpack', pid: 5, to: 6, obj: 901, end: 1, last: 11.4 }),
  J({ k: 'e', t: 13, e: 'heal', kind: 'medpack', pid: 5, to: 5, obj: 900 }),
  J({ k: 'e', t: 14.2, e: 'heal', kind: 'medpack', pid: 5, to: 5, obj: 900, end: 1, last: 13.2 }),
  J({ k: 'e', t: 20, e: 'heal', kind: 'repair', pid: 7, obj: 810 }),
  J({ k: 'e', t: 25, e: 'heal', kind: 'repair', pid: 7, obj: 810, end: 1, last: 24 }),
  J({ k: 'e', t: 30, e: 'heal', kind: 'depot', to: 6, obj: 901, depot: 820 }),
  J({ k: 'e', t: 31, e: 'heal', kind: 'depot', to: 6, obj: 901, depot: 820, end: 1, last: 30 }),
  J({ k: 'e', t: 40, e: 'heal', kind: 'medpack', pid: 5, to: 6, obj: 901 }),
  J({ k: 'e', t: 41, e: 'heal', kind: 'bandage', pid: 5, to: 6, obj: 901 }),
  // 30: the magazines of 900's item 1
  J({ k: 'st', t: 1, o: [[900, 0, 0, 0, 0, 1, 0]] }),
  J({ k: 'am', t: 1, o: [[900, 30, 60, 2, 1]] }),
  J({ k: 'am', t: 2, o: [[900, 29, 60, 2, 1], [901, 7, -1, -1, 2], ['x', 1]] }),
  J({ k: 'st', t: 3, o: [[900, 0, 0, 0, 0, 2, 0]] }),
  // 29: thief 8 takes the Axis flag (Attack, then his FlagHolder), dies and
  // lets it go; 6 returns it; 8 takes it again and captures (his drop and his
  // capture in one call).
  J({ k: 'e', t: 50, e: 'score', kind: 1, pid: 8 }),
  J({ k: 'e', t: 50.02, e: 'flagHolder', flag: 1, pid: 8 }),
  J({ k: 'e', t: 60, e: 'flagHolder', flag: 0, pid: 8 }),
  J({ k: 'e', t: 60, e: 'score', kind: 4, pid: 8 }),
  J({ k: 'e', t: 65, e: 'score', kind: 2, pid: 6 }),
  J({ k: 'e', t: 70, e: 'flagHolder', flag: 1, pid: 8 }),
  J({ k: 'e', t: 70, e: 'score', kind: 1, pid: 8 }),
  J({ k: 'e', t: 90, e: 'flagHolder', flag: 0, pid: 8 }),
  J({ k: 'e', t: 90.03, e: 'score', kind: 0, pid: 8 }),
  J({ k: 'e', t: 100, e: 'end' }),
].join('\n'));
// A client's file: the same FlagHolder as its catch-all raw record.
const client = parseRecording([
  header('bf42plus/2'), player(3, 'Julia', 2),
  J({ k: 'e', t: 5, e: 'raw', type: 30, size: 14, raw: '0103' }),
  J({ k: 'e', t: 9, e: 'raw', type: 30, size: 14, raw: '0003' }),
].join('\n'));

const flags = [{ index: 0, team: 1, position: [0, 10, 0], respawnIn: 30 }, { index: 1, team: 2, position: [500, 10, 0], respawnIn: 30 }];
const where = (pid, t) => [100 + pid, 20, t];
const state = t => ctfStateAt(server, t, flags, where, () => 5)
  .map(f => [f.team, f.home, f.carrier, f.position.map(v => +v.toFixed(2))]);
const life = { nid: 900, created: 0 };
const out = {
  skipped: server.skipped,
  heals: server.heals.map(v => [v.kind, v.pid, v.to, v.obj, v.depot, v.t, v.t1]),
  open: healsAt(server, 40.5).map(v => v.obj),
  rows: server.events.filter(e => e.kind === 'supply').map(e => e.text),
  support: supportAt(server).map(r => [r.pid, r.name, r.heals, r.self, r.repairs, r.healed, r.depot]),
  supportEarly: supportAt(server, 15).map(r => [r.pid, r.heals, r.self]),
  ammo: [0.5, 1, 2.5, 3.5].map(t => recordedAmmoAt(server, life, t)),
  ammoUnlimited: server.ammo.get(901),
  holds: server.flagHolds.map(h => [h.t, h.pid, h.flag]),
  ctfRows: server.events.filter(e => e.kind === 'ctf').map(e => `${e.t} ${e.text}`),
  ctf: { 40: state(40), 55: state(55), 62: state(62), 66: state(66), 80: state(80), 95: state(95), 62.5: state(62.5) },
  dropAgesOut: ctfStateAt(parseRecording([header('server-replay-recorder/3'), player(8, 'Thief', 2),
    J({ k: 'e', t: 10, e: 'flagHolder', flag: 1, pid: 8 }), J({ k: 'e', t: 12, e: 'flagHolder', flag: 0, pid: 8 })].join('\n')),
  50, flags, where).map(f => [f.team, f.home]),
  client: client.flagHolds.map(h => [h.t, h.pid, h.flag]),
};
console.log(JSON.stringify(out));
