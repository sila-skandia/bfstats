// The replay's Accuracy board (replay-accuracy.js), under node.
//
// The owner's ask (2026-11-01): accuracy stats for a recorded round, "use the
// server table, falling back to the recorded values being rebuilt". One
// synthetic round: a shooter on foot whom the server's round-end tally names,
// a player who leaves before the end and another who takes his pid, a pilot
// whose guns fire two rounds a pull, and grenades that burst on an enemy and
// on a teammate. One JSON report on stdout, read by test_replay_accuracy.py.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [recording, accuracy] = await Promise.all([imp('replay-recording.js'), imp('replay-accuracy.js')]);
const { accuracyBoard, accuracySeries, countBy, fireBuckets, playerDetail, rebuildTallies, totalsAt, totalsOf, weaponKind } = accuracy;

const line = o => JSON.stringify(o);
const toward = (from, to) => {
  const d = to.map((v, i) => v - from[i]);
  const n = Math.hypot(...d);
  return d.map(v => +(v / n).toFixed(4));
};
const lines = [line({ k: 'h', v: 5, start: '', hz: 10 })];
const player = (t, pid, name, team) => lines.push(line({ k: 'e', t, e: 'createPlayer', pid, name, team, ai: 0 }));
player(1, 3, 'Shooter', 2);
player(1, 5, 'Victim', 1);
player(1, 6, 'Pilot', 2);
player(1, 8, 'Leaver', 2);
player(1, 9, 'Mate', 2);
const soldier = (pid, nid, team, pos, hp = true) => {
  lines.push(line({ k: 'e', t: 1, e: 'createObject', tid: 1763, netId: nid, tmpl: 'USSoldier', pos, rot: [0, 0, 0] }));
  lines.push(line({ k: 'e', t: 1, e: 'control', pid, netId: nid }));
  lines.push(line({ k: 'o', t: 1, id: nid, gid: 1, tmpl: 'USSoldier', tid: 1763, team, maxhp: 30 }));
  if (hp) lines.push(line({ k: 'a', t: 1, a: [[nid, 30, -1]] }));
  for (let i = 0; i <= 400; i++) lines.push(line({ k: 's', t: +(1 + i * 0.1).toFixed(1), o: [[nid, ...pos, 0, 0, 0, 1]] }));
};
soldier(3, 10, 2, [0, 1, 0]);
soldier(5, 20, 1, [0, 1, 30]);
soldier(8, 12, 2, [5, 1, 0]);
soldier(9, 40, 2, [-40, 1, 10]);
// The pilot's aircraft: the round's stat is the vehicle, two barrels a pull.
lines.push(line({ k: 'e', t: 1, e: 'createObject', tid: 900, netId: 30, tmpl: 'BF109', pos: [0, 200, -300], rot: [0, 0, 0] }));
lines.push(line({ k: 'e', t: 1, e: 'control', pid: 6, netId: 30 }));
lines.push(line({ k: 'o', t: 1, id: 30, gid: 1, tmpl: 'BF109', tid: 900, team: 2, maxhp: 300 }));
for (let i = 0; i <= 400; i++) lines.push(line({ k: 's', t: +(1 + i * 0.1).toFixed(1), o: [[30, 0, 200, -300, 0, 0, 0, 1]] }));

const eye3 = [0, 1.65, 0];
const eye8 = [5, 1.65, 0];
const victim = [0, 1.65, 30];
const round = (t, pid, nid, w, p, d) => lines.push(line({ k: 'f', t, id: nid, pid, w, p, d }));
const hp = (t, nid, v) => lines.push(line({ k: 'a', t, a: [[nid, v, -1]] }));
// 5.0: through the victim, whose hit points drop 0.07 s after it arrives: a hit.
round(5, 3, 10, 'Mp40', eye3, toward(eye3, victim));
hp(5.1, 20, 20);
// 8.0: through him, and nothing drops until 10.1: a miss.
round(8, 3, 10, 'Mp40', eye3, toward(eye3, victim));
// 10.0: 15 m wide, as he loses hit points to something else: a miss.
round(10, 3, 10, 'Mp40', eye3, toward(eye3, [15, 1.65, 30]));
hp(10.1, 20, 15);
// 12.0 and 12.5: the leaver's, one with a drop behind it, one without.
round(12, 8, 12, 'Mp40', eye8, toward(eye8, victim));
hp(12.1, 20, 10);
round(12.5, 8, 12, 'Mp40', eye8, toward(eye8, victim));
// He leaves, and another player takes his pid and fires once, missing.
lines.push(line({ k: 'e', t: 14, e: 'destroyPlayer', pid: 8 }));
player(15, 8, 'Joiner', 2);
round(16, 8, 12, 'Mp40', eye8, toward(eye8, victim));
// 20.0: a grenade lobbed at the victim, who loses hit points as it bursts.
round(20, 3, 10, 'GrenadeAllies', eye3, toward(eye3, [0, 16.65, 30]));
hp(21.5, 20, 5);
// 25.0: one thrown at his teammate, who is hurt by it: a blast counts on
// the enemy only.
round(25, 3, 10, 'GrenadeAllies', eye3, toward(eye3, [-40, 8, 10]));
hp(26.5, 40, 12);
// 30.0..30.2: three pulls of the pilot's guns at nothing.
for (const t of [30, 30.1, 30.2]) round(t, 6, 30, 'BF109Guns', [0, 200, -300], [0, 0, 1]);
// 30.25: the pilot's own crosshair hit mark, as the server raised it (`hm`).
lines.push(line({ k: 'hm', t: 30.3, pid: 6, at: 30.25 }));
// The round's end: the server's tally names the shooter alone.
lines.push(line({ k: 'e', t: 40, e: 'roundStats', stat: 'fired', pid: 3, rows: [{ tid: 1, tmpl: 'Mp40', n: 40 }, { tid: 2, tmpl: 'GrenadeAllies', n: 2 }] }));
lines.push(line({ k: 'e', t: 40, e: 'roundStats', stat: 'hit', pid: 3, rows: [{ tid: 1, tmpl: 'Mp40', n: 12 }, { tid: 2, tmpl: 'GrenadeAllies', n: 1 }] }));
lines.push(line({ k: 'end', t: 41 }));
const rec = recording.parseRecording(lines.join('\n'));

const weapons = new Map([
  ['mp40', { speed: 1000, radius: null, category: 'handweapon', owner: 'mp40' }],
  ['grenadeallies', { speed: 25, radius: 15, category: 'handweapon', owner: 'grenadeallies' }],
  ['bf109guns', { speed: 400, radius: null, category: 'air', owner: 'bf109' }],
  ['tigergunbarrel', { speed: 500, radius: 4, category: 'land', owner: 'tiger' }],
]);
const gunOf = w => (w === 'bf109guns' ? { muzzles: 2, asynchronyFire: false, velocity: 400 } : null);
const options = { weapons, gunOf, thrown: new Set(['grenadeallies']) };

const results = {};
const verdicts = new Map();
rebuildTallies(rec, { ...options, verdicts });
results.verdicts = { rounds: verdicts.size, hits: [...verdicts.values()].filter(v => v.hit).length,
  pointed: [...verdicts.values()].filter(v => v.hit && Array.isArray(v.point)).length };
const tallies = rebuildTallies(rec, options);
results.rebuilt = Object.fromEntries([...tallies].map(([key, p]) => [key, Object.fromEntries([...p.rows].map(([k, r]) => [k, [r.fired, r.hit]]))]));
const board = accuracyBoard(rec, options);
results.board = Object.fromEntries(board.map(p => [p.name, {
  pid: p.pid, team: p.team, source: p.source, fired: p.fired, hit: p.hit,
  rows: p.rows.map(r => [r.tmpl, r.kind, r.fired, r.hit]),
}]));
const shooter = board.find(p => p.name === 'Shooter');
results.totals = { all: totalsOf(shooter, 'all'), infantry: totalsOf(shooter, 'infantry'), air: totalsOf(shooter, 'air') };
results.kinds = Object.fromEntries(['Mp40', 'BF109', 'Tiger', 'Sherman'].map(t => [t, weaponKind(t, weapons)]));
results.noWeapons = weaponKind('Mp40', null);
// The dashboard (2026-11-02): accuracy as the round runs, scaled to finish on
// the server's tally where it names him, and the rounds fired at a player.
{
  const at = (p, t) => {
    const v = totalsAt(p, 'all', t);
    return v && [+v.fired.toFixed(2), +v.hit.toFixed(2), v.estimated];
  };
  const leaver = board.find(p => p.name === 'Leaver');
  results.running = {
    shooterStart: at(shooter, 0), shooterAfterFirst: at(shooter, 6), shooterEnd: at(shooter, 41),
    leaverMid: at(leaver, 12.2), leaverEnd: at(leaver, 41),
    series: accuracySeries(shooter, 'all', 41, 41).length,
    buckets: fireBuckets(shooter, 'all', 41, 10).map(b => [b.fired, b.hit]),
  };
  const victim = { key: '5|Victim', pid: 5, name: 'Victim', team: 1, fired: 0, hit: 0, rows: [], shots: [], hitLog: [] };
  const d = playerDetail(rec, victim, board, options);
  results.underFire = {
    rounds: countBy(d.incoming, Infinity), hits: d.incoming.filter(x => x.hit).length, hitsTaken: d.hitsTaken,
    byT13: countBy(d.incoming, 13),
    shooters: d.shooters.map(s => [s.name, s.rounds, s.hits]),
  };
  const mine = playerDetail(rec, shooter, board, options);
  results.shooterDetail = { bursts: mine.bursts, targets: mine.targets, victims: mine.victims.map(v => [v.name, v.hits]),
    ranges: mine.ranges.map(r => r.n), farthest: mine.farthest && Math.round(mine.farthest.dist) };
}
// A server recording: one `f` per barrel, a bot's fake round marked, the
// server's own credits (`hg`).
{
  const server = [line({ k: 'h', v: 5, start: '', hz: 30, plus: 'server-replay-recorder/3' })];
  server.push(line({ k: 'e', t: 1, e: 'createPlayer', pid: 6, name: 'Pilot', team: 2, ai: 0 }));
  server.push(line({ k: 'e', t: 1, e: 'createObject', tid: 900, netId: 30, tmpl: 'BF109', pos: [0, 200, -300], rot: [0, 0, 0] }));
  server.push(line({ k: 'e', t: 1, e: 'control', pid: 6, netId: 30 }));
  server.push(line({ k: 'o', t: 1, id: 30, gid: 1, tmpl: 'BF109', tid: 900, team: 2, maxhp: 300 }));
  server.push(line({ k: 's', t: 1, o: [[30, 0, 200, -300, 0, 0, 0, 1]] }));
  for (const t of [5, 5, 5.1, 5.1]) server.push(line({ k: 'f', t, id: 30, pid: 6, w: 'BF109Guns', p: [0, 200, -300], d: [0, 0, 1] }));
  server.push(line({ k: 'f', t: 6, id: 30, pid: 6, w: 'BF109Guns', p: [0, 200, -300], d: [0, 0, 1], fake: 1 }));
  server.push(line({ k: 'hg', t: 5.2, pid: 6, tid: 900, tmpl: 'BF109' }));
  server.push(line({ k: 'i', t: 5.2, pid: 6, tid: 900, tmpl: 'BF109', o: [0, 200, -300], p: [0, 200, -250], obj: 77, dmg: 1 }));
  server.push(line({ k: 'end', t: 10 }));
  const srec = recording.parseRecording(server.join('\n'));
  const pilot = accuracyBoard(srec, options).find(p => p.name === 'Pilot');
  results.server = { serverFile: srec.serverFile, impacts: srec.impacts.length, source: pilot?.source, fired: pilot?.fired, hit: pilot?.hit };
}
// No tally in the file at all: everyone is rebuilt.
rec.roundStats.clear();
results.allRebuilt = accuracyBoard(rec, options).map(p => p.source);
console.log(JSON.stringify(results));
