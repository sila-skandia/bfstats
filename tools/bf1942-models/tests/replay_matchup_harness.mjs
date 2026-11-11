// The replay's match-up under node (replay-matchup.js): the fights near the
// playhead, the rounds between two things, each hit's recorded drop, where
// one was seen from the other, the soldier's body part a drop names, what a
// gun does to a hull's armour, and the words. Every case is a small
// recording written here line by line, so each says exactly what happened.
//
// Same pattern as `replay_dossier_harness.mjs`: one node run, one JSON
// report, the modules imported from the viewer tree in place.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [R, A, M, K] = await Promise.all([
  imp('replay-recording.js'), imp('replay-accuracy.js'), imp('replay-matchup.js'), imp('replay-kinematics.js'),
]);

const results = {};
const r2 = v => (v === null || v === undefined ? v : Math.round(v * 100) / 100);

function recording(build) {
  const lines = [];
  build(o => lines.push(JSON.stringify(o)));
  return R.parseRecording(lines.join('\n'));
}
const player = (L, pid, name, team, t = 0.2) => L({ k: 'e', t, e: 'createPlayer', pid, name, team, ai: 1 });
/** A hull at `pos` (BF1942's frame) facing `q`, with `pid` driving it. */
function hull(L, t, nid, tmpl, pos, pid, team, maxhp = 100, q = [0, 0, 0, 1]) {
  L({ k: 'e', t, e: 'createObject', netId: nid, tmpl, tid: 900, pos, rot: [0, 0, 0] });
  L({ k: 'o', t, id: nid, tmpl, tid: 900, team, maxhp });
  L({ k: 's', t, o: [[nid, ...pos, ...q]] });
  L({ k: 'a', t, a: [[nid, maxhp, -1]] });
  L({ k: 'p', t, p: [[pid, team, nid, nid, 0]] });
}
function soldier(L, t, nid, pid, team, pos) {
  const tmpl = team === 1 ? 'GermanSoldier' : 'USSoldier';
  L({ k: 'e', t, e: 'createObject', netId: nid, tmpl, tid: 1700 + team, pos, rot: [0, 0, 0] });
  L({ k: 'o', t, id: nid, tmpl, tid: 1700 + team, team, maxhp: 30 });
  L({ k: 's', t, o: [[nid, pos[0], pos[1] + 1, pos[2], 0, 0, 0, 1]] });
  L({ k: 'a', t, a: [[nid, 30, -1]] });
  L({ k: 'p', t, p: [[pid, team, nid]] });
}
const fire = (L, t, pid, nid, weapon, pos, dir) => L({ k: 'f', t, pid, id: nid, w: weapon, p: pos, d: dir });
const hp = (L, t, nid, value) => L({ k: 'a', t, a: [[nid, value, -1]] });
const kill = (L, t, killer, victim, weapon) => L({ k: 'e', t, e: 'score', kind: 3, pid: killer, victim, weaponName: weapon });
const unit = (a, b) => {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = Math.hypot(...d);
  return d.map(v => v / n);
};

// --- (a) A tank duel ----------------------------------------------------------------------
//
// A Sherman (pid 1, Allies) at the origin and a Tiger (pid 2, Axis) 200 m up
// BF1942's +z, both facing +z: the Tiger's back is to the Sherman. At 10 s
// the Sherman fires three rounds: one into the Tiger (its hit points 100 to
// 67 just after the round gets there), one that passes 5 m wide, one 30 m
// wide. At 14 s the Tiger, turned round, fires one that kills the Sherman.
const sherman = [0, 0, 0];
const tiger = [0, 0, 200];
const duel = recording(L => {
  player(L, 1, 'Ann', 2);
  player(L, 2, 'Kai', 1);
  hull(L, 1, 100, 'Sherman', sherman, 1, 2, 100);
  hull(L, 1, 200, 'Tiger', tiger, 2, 1, 100);
  for (let t = 1.1; t < 20; t += 0.1) L({ k: 's', t: Math.round(t * 10) / 10, o: [[100, ...sherman, 0, 0, 0, 1], [200, ...tiger, 0, 0, 0, 1]] });
  fire(L, 10, 1, 100, 'ShermanGunBarrel', sherman, unit(sherman, tiger));
  hp(L, 10.75, 200, 67);
  fire(L, 11, 1, 100, 'ShermanGunBarrel', sherman, unit(sherman, [5, 0, 200]));
  fire(L, 12, 1, 100, 'ShermanGunBarrel', sherman, unit(sherman, [30, 0, 200]));
  fire(L, 14, 2, 200, 'TigerGunBarrel', tiger, unit(tiger, sherman));
  hp(L, 14.75, 100, 0);
  kill(L, 14.8, 2, 1, 'Tiger');
  L({ k: 'end', t: 20 });
});
const weapons = new Map([['shermangunbarrel', { speed: 300, category: 'land' }], ['tigergunbarrel', { speed: 300, category: 'land' }]]);
const board = A.accuracyBoard(duel, { weapons });
const shots = board.flatMap(e => e.shots ?? []);
const kills = duel.kills;
const fights = M.fightsNear(duel, shots, kills, 13, { follow: 1 });
const f0 = fights[0];
const rounds = M.assignDrops(M.roundsBetween(duel, f0.a, f0.b, f0.first - 2, f0.last + 2, {
  shotOf: f => shots.find(s => s.f === f) ?? null, speedOf: () => 300,
}));
results.duel = {
  fights: fights.length,
  a: f0.a.tmpl, b: f0.b.tmpl, hits: f0.hits, kill: Boolean(f0.kill), killer: f0.kill?.killer?.tmpl ?? null,
  moment: r2(f0.moment),
  rounds: rounds.map(r => ({ by: r.by, kind: r.kind, t: r.f.t, miss: r2(r.miss), drop: r.drop ? r2(r.drop.amount) : null })),
  tallyA: M.tallyOf(rounds.filter(r => r.by === 'a')),
  tallyB: M.tallyOf(rounds.filter(r => r.by === 'b')),
  // The Sherman is behind the Tiger; the Tiger is ahead of the Sherman.
  seenByA: M.seenFrom(f0.a, f0.b, 10, K.poseAt),
  seenByB: M.seenFrom(f0.b, f0.a, 10, K.poseAt),
  label: M.labelOf(duel, f0.a, 10),
  // Outside the fight, the moment is just before its kill.
  momentFromAfar: r2(M.fightsNear(duel, shots, kills, 40, { window: 30 })[0]?.moment ?? null),
  nothingFar: M.fightsNear(duel, shots, kills, 80, { window: 30 }).length,
};

// --- (b) Two rounds on one drop ----------------------------------------------------------
//
// Two rounds arriving together and one drop: only the first gets it.
const twice = recording(L => {
  player(L, 1, 'Ann', 2);
  player(L, 2, 'Kai', 1);
  hull(L, 1, 100, 'Sherman', sherman, 1, 2, 100);
  hull(L, 1, 200, 'Tiger', tiger, 2, 1, 100);
  for (let t = 1.1; t < 20; t += 0.1) L({ k: 's', t: Math.round(t * 10) / 10, o: [[100, ...sherman, 0, 0, 0, 1], [200, ...tiger, 0, 0, 0, 1]] });
  fire(L, 10, 1, 100, 'ShermanGunBarrel', sherman, unit(sherman, tiger));
  fire(L, 10.01, 1, 100, 'ShermanGunBarrel', sherman, unit(sherman, tiger));
  hp(L, 10.75, 200, 70);
  L({ k: 'end', t: 20 });
});
{
  const b = A.accuracyBoard(twice, { weapons });
  const s = b.flatMap(e => e.shots ?? []);
  const fs = M.fightsNear(twice, s, twice.kills, 10);
  const rs = fs.length ? M.assignDrops(M.roundsBetween(twice, fs[0].a, fs[0].b, 8, 13, {
    shotOf: f => s.find(x => x.f === f) ?? null, speedOf: () => 300,
  })) : [];
  results.twice = rs.map(r => ({ kind: r.kind, drop: r.drop ? r2(r.drop.amount) : null }));
}

// --- (b2) A kill shot no verdict credited, and a dummy round ----------------------------
//
// The Sherman fires a dummy beside its round (FHSW's `_Dummy`, which only
// draws), then a round that passes 2 m off the Tiger's middle just before
// its hit points drop: the rebuild credits nothing (the round is aimed 2 m
// to the side, past its 4 m catch only for a hull), but it passed through
// the hull and nothing else took the drop.
const missed = recording(L => {
  player(L, 1, 'Ann', 2);
  player(L, 2, 'Kai', 1);
  hull(L, 1, 100, 'Sherman', sherman, 1, 2, 100);
  hull(L, 1, 200, 'Tiger', tiger, 2, 1, 100);
  for (let t = 1.1; t < 20; t += 0.1) L({ k: 's', t: Math.round(t * 10) / 10, o: [[100, ...sherman, 0, 0, 0, 1], [200, ...tiger, 0, 0, 0, 1]] });
  fire(L, 10, 1, 100, 'ShermanGunBarrel_Dummy', sherman, unit(sherman, tiger));
  fire(L, 10, 1, 100, 'ShermanGunBarrel', sherman, unit(sherman, [2, 1, 200]));
  hp(L, 10.75, 200, 40);
  L({ k: 'end', t: 20 });
});
{
  const rs = M.assignDrops(M.roundsBetween(missed, missed.lives.find(l => l.nid === 100), missed.lives.find(l => l.nid === 200), 8, 13, {
    shotOf: () => null, speedOf: () => 300,
  }));
  results.inferred = rs.map(r => ({ weapon: r.f.weapon, kind: r.kind, inferred: Boolean(r.inferred), drop: r.drop ? r2(r.drop.amount) : null }));
}

// --- (c) A soldier's body parts -----------------------------------------------------------
const thompson = m => ({ 40: 15, 41: 9, 42: 5 })[m] ?? 0;
results.parts = {
  chest: M.bodyPartFor(9, thompson)?.part.id ?? null,
  head: M.bodyPartFor(14.6, thompson)?.part.id ?? null,
  none: M.bodyPartFor(7, thompson),
  // A kill of a man on 4 left: head, chest or limbs all cost that.
  killedAny: M.bodyPartFor(4, thompson, { killed: true }),
  // A kill of a man on 12 left: only a head shot costs that much.
  killedHead: M.bodyPartFor(12, thompson, { killed: true })?.part.id ?? null,
};

// --- (d) What one gun does to a hull's armour --------------------------------------------
const labels = { 33: '20mm', 39: '40mm', 53: '100mm', 58: '150mm', 37: 'Armor' };
const hurts = new Set([33, 39]);
results.armour = M.armourAgainst([33, 39, 53, 58, 37, 53, NaN], m => (hurts.has(m) ? 10 : 0), m => labels[m]);
results.armourMixed = M.armourAgainst([33, 53, 58], m => (m === 58 ? 5 : m === 33 ? 10 : 0), m => labels[m]);
results.plateMm = [M.plateMm('7,5mm'), M.plateMm('150mm'), M.plateMm('Armor')];

// --- (e) Aspect words, and the words ----------------------------------------------------
results.aspects = [0, 40, -40, 90, -100, 130, 180].map(b => M.aspectWords(b));
results.words = M.sideWords(
  { who: 'Ann', gun: '75 mm L37,5A gun', tally: { fired: 6, hit: 2, glanced: 3, missed: 1, dealt: 76.2 },
    armour: { immune: 16, of: 25, from: '100 mm' }, seen: { aspect: 'head on', share: 0.22, hits: 6, range: 312 } },
  { who: 'Kai', what: 'King Tiger' },
);
results.wordsNothing = M.sideWords({ who: 'Kai', gun: null, tally: { fired: 0 } }, { who: 'Ann', what: 'Sherman' });
results.ending = M.endingWords({ a: 'x', kill: { killer: 'y', weapon: 'Tiger' } }, { who: 'Ann' }, { who: 'Kai' });

// --- (f) A soldier against a tank --------------------------------------------------------
//
// A soldier 40 m off a Tiger's side fires a bazooka into it (its hit points
// drop), and the Tiger's gunner kills them: their thing is their soldier, the
// Tiger's is the hull.
const foot = recording(L => {
  player(L, 3, 'Sol', 2);
  player(L, 2, 'Kai', 1);
  soldier(L, 1, 300, 3, 2, [40, 0, 200]);
  hull(L, 1, 200, 'Tiger', tiger, 2, 1, 100);
  for (let t = 1.1; t < 20; t += 0.1) L({ k: 's', t: Math.round(t * 10) / 10, o: [[300, 40, 1, 200, 0, 0, 0, 1], [200, ...tiger, 0, 0, 0, 1]] });
  fire(L, 5, 3, 300, 'Bazooka', [40, 1.6, 200], unit([40, 1.6, 200], tiger));
  hp(L, 5.6, 200, 60);
  kill(L, 8, 2, 3, 'Tiger');
  L({ k: 'end', t: 20 });
});
{
  const b = A.accuracyBoard(foot, { weapons: new Map([['bazooka', { speed: 85, category: 'handweapon' }]]) });
  const s = b.flatMap(e => e.shots ?? []);
  const fs = M.fightsNear(foot, s, foot.kills, 6, { follow: 3 });
  results.foot = fs.map(f => ({ a: f.a.soldier ? 'soldier' : f.a.tmpl, b: f.b.soldier ? 'soldier' : f.b.tmpl, hits: f.hits, kill: Boolean(f.kill) }));
}

console.log(JSON.stringify(results));
