// A player's dossier under node (replay-dossier.js): the round that made each
// kill, each kill's distance, and one player's round sliced into streaks,
// longest shots, multi-kills, vehicles, deaths and weapons, each read off a
// small recording written here line by line, so every case says exactly
// what happened. When the owner's real rounds are on disk (`viewer/replays`,
// untracked), the same facts are read from them and their headline numbers
// reported.
//
// Same pattern as `replay_highlights_harness.mjs`: one node run, one JSON
// report, the modules imported from the viewer tree in place through
// `sim/env.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [R, C, B, M, D] = await Promise.all([
  imp('replay-recording.js'), imp('replay-chapters.js'), imp('replay-battles.js'), imp('replay-medals.js'),
  imp('replay-dossier.js'),
]);

const results = {};

/** A recording from its lines: `L({...})` writes one. */
function recording(build) {
  const lines = [];
  build(o => lines.push(JSON.stringify(o)));
  return R.parseRecording(lines.join('\n'));
}

/** A soldier made, replicated and sampled standing at `pos` (BF1942's frame,
 *  his feet: the sample is his origin, a metre up), and `pid` put in him. */
function soldier(L, t, nid, pid, team, pos, tmpl = team === 1 ? 'GermanSoldier' : 'USSoldier') {
  L({ k: 'e', t, e: 'createObject', netId: nid, tmpl, tid: 1700 + team, pos, rot: [0, 0, 0] });
  L({ k: 'o', t, id: nid, tmpl, tid: 1700 + team, team, maxhp: 30 });
  L({ k: 's', t, o: [[nid, pos[0], pos[1] + 1, pos[2], 0, 0, 0, 1]] });
  L({ k: 'p', t, p: [[pid, team, nid]] });
}
/** A hull at `pos` with `pid` in its driving seat. */
function hull(L, t, nid, tmpl, pos, pid, team) {
  L({ k: 'e', t, e: 'createObject', netId: nid, tmpl, tid: 900, pos, rot: [0, 0, 0] });
  L({ k: 'o', t, id: nid, tmpl, tid: 900, team, maxhp: 100 });
  L({ k: 's', t, o: [[nid, ...pos, 0, 0, 0, 1]] });
  L({ k: 'p', t, p: [[pid, team, nid, nid, 0]] });
}
const player = (L, pid, name, team, t = 0.2) => L({ k: 'e', t, e: 'createPlayer', pid, name, team, ai: 1 });
const kill = (L, t, killer, victim, weapon) => L({ k: 'e', t, e: 'score', kind: 3, pid: killer, victim, weaponName: weapon });
const teamKill = (L, t, killer, victim, weapon) => L({ k: 'e', t, e: 'score', kind: 6, pid: killer, victim, weaponName: weapon });
const died = (L, t, pid) => L({ k: 'e', t, e: 'score', kind: 4, pid });
const fire = (L, t, pid, nid, weapon, pos, dir) => L({ k: 'f', t, pid, id: nid, w: weapon, p: pos, d: dir });

/** A standing man's eye, where his rounds leave (his origin plus 0.65 m),
 *  and his chest, where they strike (his origin plus 0.3 m): BF1942's frame,
 *  from his feet. */
const eye = p => [p[0], p[1] + 1.65, p[2]];
const chest = p => [p[0], p[1] + 1.3, p[2]];
/** The direction from `a` to `b` (BF1942's frame), turned `yaw` degrees
 *  about +Y and raised `up` degrees. */
function toward(a, b, yaw = 0, up = 0) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = Math.hypot(...d);
  const [x, y, z] = d.map(v => v / n);
  const ya = (yaw * Math.PI) / 180;
  const h = [x * Math.cos(ya) + z * Math.sin(ya), y, -x * Math.sin(ya) + z * Math.cos(ya)];
  const flat = Math.hypot(h[0], h[2]);
  const pitch = Math.atan2(h[1], flat) + (up * Math.PI) / 180;
  return [(h[0] / flat) * Math.cos(pitch), Math.sin(pitch), (h[2] / flat) * Math.cos(pitch)];
}
const r2 = v => (v === null || v === undefined ? v : Math.round(v * 100) / 100);
/** A found round in brief: its weapon, when it left, its kind, angle and
 *  distance. */
const brief = r => (r ? { weapon: r.f.weapon, t: r2(r.f.t), kind: r.kind, angle: r2(r.angle), distance: r2(r.distance) } : null);

// --- the killing round ------------------------------------------------------------------
//
// Duels far apart in place and time, each its own killer and victim, so no
// man's rounds are another kill's.
// (a) A Thompson burst 30 m off: four rounds 6, 4, 0.5 and 3 degrees wide,
//     the kill a tenth of a second after the last. The 0.5-degree one.
// (b) A K98 round 1.5 s before the kill 0.5 degrees wide, and one 0.1 s
//     before 2 degrees wide: age costs 2 degrees a second, the later one.
// (c) Mp40 rounds 15 and 20 degrees wide: none.
// (d) A PanzerIV's kill: its gun barrel's round 1.5 degrees wide, its
//     coaxial gun's 0.2 degrees later. The kill names the tank; the barrel
//     is its weapon's.
// (e) The same with the barrel's round 4 s old: the coaxial gun's.
// (f) Two grenades thrown 3 s and 1 s before a grenade kill, and an Mp40
//     round at the man: the throw the fuse fits.
// (g) A landmine laid 4 s before its kill: no round.
// (h) A K98 round along +z (BF1942's) at a man 60 m along +z, -z in the
//     viewer's frame: his. The same round at a man 60 m along -z: none.
// (i) A Mustang's guns, then its bomb 1 s before the kill: the bomb. A
//     BF109's bomb, then its guns up to the kill: the guns. A B17's stick,
//     a bomb every 0.27 s: the latest that had fallen for 0.4 s.
// (j) A sniper's man out of the recording's range at the kill: the latest
//     round within a second, with no angle or distance.
// (k) A pistol round at a man's chest from 3 m: his (0.3 m over his feet it
//     is 17 degrees off).
// (l) A man shot 0.05 s after he got out of his Kubelwagen, his soldier
//     back in range at the place he got in at, 693 m off: placed where the
//     recording next has him, 20 m from his killer (replay-battles.js
//     `settledTime`).
{
  const duels = [];
  const rec = recording(L => {
    L({ k: 'h', v: 5 });
    /** A duel's two men, the victim on foot at `to`, the killer on foot at
     *  `from` or in hull `ride`, `{ tmpl, nid }`; returns the killer's nid. */
    const duel = (name, t, killer, victim, from, to, ride = null) => {
      player(L, killer, `${name} killer`, 1);
      player(L, victim, `${name} victim`, 2);
      if (ride) hull(L, 1, ride.nid, ride.tmpl, from, killer, 1);
      else soldier(L, 1, 1000 + killer, killer, 1, from);
      soldier(L, 1, 2000 + victim, victim, 2, to);
      duels.push({ name, t, killer, victim });
      return ride ? ride.nid : 1000 + killer;
    };
    {
      const [a, v] = [[0, 0, 0], [30, 0, 0]];
      const k = duel('burst', 10, 1, 51, a, v);
      for (const [t, yaw] of [[9.6, 6], [9.7, 4], [9.8, 0.5], [9.9, -3]]) fire(L, t, 1, k, 'Thompson', eye(a), toward(eye(a), chest(v), yaw));
      kill(L, 10, 1, 51, 'Thompson');
    }
    {
      const [a, v] = [[0, 0, 100], [40, 0, 100]];
      const k = duel('age', 20, 2, 52, a, v);
      fire(L, 18.5, 2, k, 'K98', eye(a), toward(eye(a), chest(v), 0.5));
      fire(L, 19.9, 2, k, 'K98', eye(a), toward(eye(a), chest(v), 2));
      kill(L, 20, 2, 52, 'K98');
    }
    {
      const [a, v] = [[0, 0, 200], [30, 0, 200]];
      const k = duel('wide', 30, 3, 53, a, v);
      fire(L, 29.8, 3, k, 'Mp40', eye(a), toward(eye(a), chest(v), 20));
      fire(L, 29.9, 3, k, 'Mp40', eye(a), toward(eye(a), chest(v), -15));
      kill(L, 30, 3, 53, 'Mp40');
    }
    for (const [name, t, killer, victim, z, barrelAt] of [['prefix', 40, 4, 54, 300, 39.5], ['coaxial', 50, 5, 55, 400, 46]]) {
      const [a, v] = [[0, 0, z], [60, 0, z]];
      const k = duel(name, t, killer, victim, a, v, { tmpl: 'PanzerIV', nid: 3000 + killer });
      const gun = [a[0], a[1] + 2, a[2]];
      fire(L, barrelAt, killer, k, 'PanzerIVGunBarrel', gun, toward(gun, chest(v), 1.5));
      fire(L, t - 0.1, killer, k, 'Coaxial_MG42', gun, toward(gun, chest(v), 0.2));
      kill(L, t, killer, victim, 'PanzerIV');
    }
    {
      const [a, v] = [[0, 0, 500], [20, 0, 500]];
      const k = duel('grenade', 60, 6, 56, a, v);
      fire(L, 57, 6, k, 'GrenadeAxis', eye(a), toward(eye(a), chest(v), 5, 30));
      fire(L, 59, 6, k, 'GrenadeAxis', eye(a), toward(eye(a), chest(v), -8, 35));
      fire(L, 59.9, 6, k, 'Mp40', eye(a), toward(eye(a), chest(v)));
      kill(L, 60, 6, 56, 'GrenadeAxis');
    }
    {
      const [a, v] = [[0, 0, 600], [5, 0, 600]];
      const k = duel('landmine', 66, 7, 57, a, v);
      fire(L, 62, 7, k, 'Landmine', eye(a), toward(eye(a), v));
      kill(L, 66, 7, 57, 'Landmine');
    }
    for (const [name, t, killer, victim, z, dz] of [['plus z', 70, 8, 58, 700, 60], ['minus z', 72, 9, 59, 800, -60]]) {
      const [a, v] = [[0, 0, z], [0, 0, z + dz]];
      const k = duel(name, t, killer, victim, a, v);
      // Along +z, dropping from his eye to the chest of a man 60 m on.
      fire(L, t - 0.1, killer, k, 'K98', eye(a), [0, -0.35 / 60, 1]);
      kill(L, t, killer, victim, 'K98');
    }
    {
      const [a, v] = [[0, 60, 900], [40, 0, 900]];
      const k = duel('mustang', 80, 10, 60, a, v, { tmpl: 'Mustang', nid: 3010 });
      for (const t of [77.5, 77.6, 77.7, 77.8, 77.9, 78]) fire(L, t, 10, k, 'MustangGuns', a, toward(a, chest(v)));
      fire(L, 79, 10, k, 'MustangBombDummy', a, toward(a, chest(v), 0, 20));
      kill(L, 80, 10, 60, 'Mustang');
    }
    {
      const [a, v] = [[0, 30, 1000], [30, 0, 1000]];
      const k = duel('bf109', 90, 21, 61, a, v, { tmpl: 'BF109', nid: 3021 });
      fire(L, 88, 21, k, 'BF109BombRack', a, toward(a, chest(v), 0, 20));
      for (const t of [89.5, 89.8]) fire(L, t, 21, k, 'BF109Guns', a, toward(a, chest(v), 1));
      kill(L, 90, 21, 61, 'BF109');
    }
    {
      const [a, v] = [[0, 150, 1100], [60, 0, 1100]];
      const k = duel('b17', 96.2, 23, 63, a, v, { tmpl: 'B17', nid: 3023 });
      for (const t of [95, 95.27, 95.54, 95.81, 96.08]) fire(L, t, 23, k, 'B17BombRack', a, [1, 0, 0]);
      kill(L, 96.2, 23, 63, 'B17');
    }
    {
      const [a, v] = [[0, 0, 1200], [300, 0, 1200]];
      const k = duel('unseen', 105, 24, 64, a, v);
      L({ k: 'd', t: 100, id: 2064 });
      fire(L, 102, 24, k, 'K98Sniper', eye(a), toward(eye(a), chest(v)));
      fire(L, 104.5, 24, k, 'K98Sniper', eye(a), toward(eye(a), chest(v)));
      kill(L, 105, 24, 64, 'K98Sniper');
    }
    {
      const [a, v] = [[0, 0, 1300], [3, 0, 1300]];
      const k = duel('point blank', 110, 26, 66, a, v);
      fire(L, 109.95, 26, k, 'Colt', eye(a), toward(eye(a), chest(v)));
      kill(L, 110, 26, 66, 'Colt');
    }
    {
      // He got in at (500, 0, 1900) and drove to (0, 0, 1400).
      const [a, door] = [[20, 0, 1400], [0, 0, 1400]];
      const k = duel('rejoin', 120, 29, 68, a, [500, 0, 1900]);
      L({ k: 'd', t: 2, id: 2068 });
      hull(L, 2, 3068, 'Kubelwagen', door, 68, 2);
      L({ k: 'o', t: 119.9, id: 2068, tmpl: 'USSoldier', tid: 1702, team: 2, maxhp: 30 });
      L({ k: 's', t: 119.9, o: [[2068, 500, 1, 1900, 0, 0, 0, 1]] });
      L({ k: 'p', t: 119.9, p: [[68, 2, 2068]] });
      fire(L, 119.95, 29, k, 'Thompson', eye(a), toward(eye(a), chest(door)));
      kill(L, 120, 29, 68, 'Thompson');
      L({ k: 's', t: 120.1, o: [[2068, 0, 1, 1400, 0, 0, 0, 1]] });
    }
    L({ k: 's', t: 125, o: [] });
  });
  const facts = D.killFactsOf(rec, rec.kills);
  const lineOf = d => rec.kills.find(k => k.killer === d.killer && k.victim === d.victim && Math.abs(k.t - d.t) < 1e-6);
  results.rounds = {};
  for (const d of duels) {
    const k = lineOf(d);
    const fact = facts.get(k);
    results.rounds[d.name] = {
      round: brief(D.killingRound(rec, k)),
      fact: fact ? { distance: fact.distance, from: fact.from, fresh: fact.fresh, round: brief(fact.round) } : null,
    };
  }
  // What `whereIs` makes of the man just out of his Kubelwagen: live, where
  // the recording next has him, 20 m from his killer, not 693.
  const exit = lineOf(duels.find(d => d.name === 'rejoin'));
  const w = B.whereIs(rec, exit.victim, exit.t - 0.05);
  const kw = B.whereIs(rec, exit.killer, exit.t - 0.05);
  results.rounds.rejoin.whereIs = { fresh: w.fresh, ground: Math.round(Math.hypot(w.pos[0] - kw.pos[0], w.pos[2] - kw.pos[2])) };
}

// --- one player's round -------------------------------------------------------------------
//
// Hero (Axis) kills Vic, Val and Vera at 10, 13 and 17 s (20, 45 and 8 m:
// first blood, a triple kill, a killing spree, the kill lead), team-kills
// Mate 200 m off at 20 s and kills Vic again 90 m off at 30 s. Nemo kills
// him at 40 s: a streak of 4 ended. Back at 45 s, he snipes Vic from 150 m
// at 60 s and from 30 m at 64 s (a long shot, a double kill), then dies by
// his own hand at 70 s: a streak of 2 ended. Back at 72 s, he grenades Vic
// at 80 s and blows himself up at 85 s (a kill line naming himself). Val
// kills him at 90 s; he kills Vera from 12 m at 95 s and Nemo kills him
// again at 100 s. The server credits him a Sherman (Allies aboard), a Tiger
// (his own side's) and an empty Willys.
{
  const rec = recording(L => {
    L({ k: 'h', v: 5 });
    for (const [pid, name, team] of [[1, 'Hero', 1], [2, 'Vic', 2], [3, 'Val', 2], [4, 'Vera', 2], [5, 'Nemo', 2], [6, 'Mate', 1]]) {
      player(L, pid, name, team);
    }
    L({ k: 'e', t: 0.5, e: 'gameStatus', status: 3 });
    L({ k: 'e', t: 1, e: 'gameStatus', status: 1 });
    const at = new Map();
    const spawn = (t, nid, pid, team, pos) => {
      soldier(L, t, nid, pid, team, pos);
      at.set(pid, { nid, pos });
    };
    /** `pid` shoots `victim` where each stands, `dt` before `t`, and the
     *  kill line follows. */
    const shoot = (t, pid, victim, weapon, { dt = 0.1, line = kill } = {}) => {
      const a = at.get(pid);
      const v = at.get(victim);
      fire(L, +(t - dt).toFixed(2), pid, a.nid, weapon, eye(a.pos), toward(eye(a.pos), chest(v.pos)));
      line(L, t, pid, victim, weapon);
    };
    spawn(1, 100, 1, 1, [0, 0, 0]);
    spawn(1, 200, 2, 2, [20, 0, 0]);
    spawn(1, 300, 3, 2, [0, 0, 45]);
    spawn(1, 400, 4, 2, [-8, 0, 0]);
    spawn(1, 500, 5, 2, [0, 0, 30]);
    spawn(1, 600, 6, 1, [0, 0, -200]);
    shoot(10, 1, 2, 'Thompson');
    shoot(13, 1, 3, 'Thompson');
    shoot(17, 1, 4, 'Thompson', { dt: 0.05 });
    shoot(20, 1, 6, 'Thompson', { line: teamKill });
    spawn(25, 201, 2, 2, [90, 0, 0]);
    shoot(30, 1, 2, 'Thompson');
    shoot(40, 5, 1, 'Thompson');
    spawn(45, 101, 1, 1, [0, 0, 0]);
    spawn(55, 202, 2, 2, [150, 0, 0]);
    shoot(60, 1, 2, 'K98Sniper');
    spawn(62, 203, 2, 2, [30, 0, 0]);
    shoot(64, 1, 2, 'K98Sniper');
    died(L, 70, 1);
    spawn(72, 102, 1, 1, [0, 0, 0]);
    spawn(75, 204, 2, 2, [25, 0, 0]);
    shoot(80, 1, 2, 'GrenadeAxis', { dt: 3 });
    fire(L, 82, 1, 102, 'GrenadeAxis', eye([0, 0, 0]), [0, 0.5, 0.866]);
    kill(L, 85, 1, 1, 'GrenadeAxis');
    spawn(85, 301, 3, 2, [0, 0, -40]);
    spawn(87, 103, 1, 1, [0, 0, 0]);
    shoot(90, 3, 1, 'M1Garand');
    spawn(92, 104, 1, 1, [0, 0, 0]);
    spawn(93, 401, 4, 2, [12, 0, 0]);
    shoot(95, 1, 4, 'Thompson');
    shoot(100, 5, 1, 'Thompson');
    L({ k: 's', t: 105, o: [] });
  });
  const kills = rec.kills;
  const chapters = [
    { t: 50, kind: 'vehicle', tmpl: 'Sherman', crew: [5], by: 1 },
    { t: 52, kind: 'vehicle', tmpl: 'Tiger', crew: [6], by: 1 },
    { t: 54, kind: 'vehicle', tmpl: 'Willys', crew: [], by: 1 },
    { t: 56, kind: 'vehicle', tmpl: 'Jeep', crew: [2], by: 5 },
  ];
  const medals = M.medalsOf(rec, kills, { chapters });
  const facts = D.killFactsOf(rec, kills);
  const names = { Thompson: 'Thompson SMG', K98Sniper: 'Kar98k scope', Sherman: 'M4 Sherman' };
  const display = s => names[s] ?? s;
  const hero = D.dossierOf(rec, 1, { kills, facts, medals, chapters, display });
  const row = r => [r.t, r.victimName, r.weapon, r.distance];
  results.dossier = {
    name: hero.name,
    team: hero.team,
    summary: hero.summary,
    streaks: hero.streaks.map(s => ({ n: s.n, t0: s.t0, t1: s.t1, end: s.end, kills: s.kills.map(r => r.t) })),
    multis: hero.multis.map(m => ({ n: m.n, t0: m.t0, t1: m.t1, label: m.label, kills: m.kills.map(r => r.t) })),
    longest: hero.longest.map(row),
    kills: hero.kills.map(r => [...row(r), r.weaponName, r.from, r.teamkill, r.round?.kind ?? null]),
    deaths: hero.deaths,
    weapons: hero.weapons,
    vehicles: hero.vehicles,
    medals: hero.medals.map(m => [m.t, m.label]),
    // One row per kill, the same object in every list it is in.
    shared: hero.longest[0] === hero.kills.find(r => r.t === 60) && hero.streaks[0].kills[0] === hero.multis[0].kills[0],
    // The facts of every kill line with a killer who is not its victim.
    factLines: [...facts.keys()].map(k => [k.t, k.kind]),
  };
  // Nemo never dies: a streak the round ended.
  const nemo = D.dossierOf(rec, 5, { kills, facts, medals, chapters, display });
  results.dossier.nemo = { summary: nemo.summary, streaks: nemo.streaks.map(s => [s.n, s.t0, s.t1, s.end]) };
  // Someone the recording never saw.
  const nobody = D.dossierOf(rec, 99, { kills, facts });
  results.dossier.nobody = { name: nobody.name, summary: nobody.summary, lists: ['streaks', 'longest', 'multis', 'vehicles', 'kills', 'deaths', 'weapons', 'medals'].map(k => nobody[k].length) };
  // With no facts handed in, it reads them itself.
  results.dossier.ownFacts = D.dossierOf(rec, 1).summary.longest;
}

// --- one id, two players ----------------------------------------------------------------
//
// A public server gives a leaver's id to the next man to join. Omen (pid 7)
// kills Xan at 10 and 20 s and leaves at 30 s; Niconan joins as pid 7 at
// 40 s and kills Xan at 50 s.
{
  const rec = recording(L => {
    L({ k: 'h', v: 5 });
    player(L, 7, 'Omen', 1);
    player(L, 8, 'Xan', 2);
    soldier(L, 1, 700, 7, 1, [0, 0, 0]);
    soldier(L, 1, 800, 8, 2, [30, 0, 0]);
    fire(L, 9.9, 7, 700, 'Mp40', eye([0, 0, 0]), toward(eye([0, 0, 0]), chest([30, 0, 0])));
    kill(L, 10, 7, 8, 'Mp40');
    soldier(L, 12, 801, 8, 2, [30, 0, 0]);
    fire(L, 19.9, 7, 700, 'Mp40', eye([0, 0, 0]), toward(eye([0, 0, 0]), chest([30, 0, 0])));
    kill(L, 20, 7, 8, 'Mp40');
    L({ k: 'e', t: 30, e: 'destroyPlayer', pid: 7 });
    player(L, 7, 'Niconan', 1, 40);
    soldier(L, 42, 701, 7, 1, [0, 0, 0]);
    soldier(L, 44, 802, 8, 2, [30, 0, 0]);
    fire(L, 49.9, 7, 701, 'Thompson', eye([0, 0, 0]), toward(eye([0, 0, 0]), chest([30, 0, 0])));
    kill(L, 50, 7, 8, 'Thompson');
    L({ k: 's', t: 55, o: [] });
  });
  const outline = d => ({ name: d.name, kills: d.kills.map(r => r.t), rounds: d.summary.rounds, prey: d.summary.prey,
                          nemesis: d.summary.nemesis, deaths: d.summary.deaths });
  results.reuse = {
    last: outline(D.dossierOf(rec, 7)),
    first: outline(D.dossierOf(rec, 7, { t: 15 })),
    xan: outline(D.dossierOf(rec, 8)),
  };
}

// --- the owner's rounds, where they are on disk ------------------------------------------
{
  results.real = {};
  for (const name of ['replay_20260928-133433', 'replay_20260928-161948']) {
    const file = path.join(viewer, 'replays', `${name}.ndjson`);
    if (!fs.existsSync(file)) continue;
    const rec = R.parseRecording(fs.readFileSync(file, 'utf8'));
    const kills = rec.kills;
    let started = performance.now();
    const facts = D.killFactsOf(rec, kills);
    const ms = performance.now() - started;
    const scored = kills.filter(k => k.kind === 'kill' && k.killer !== null && k.killer !== k.victim);
    const kinds = {};
    for (const f of facts.values()) if (f.round) kinds[f.round.kind] = (kinds[f.round.kind] ?? 0) + 1;
    const chapters = C.buildChapters(rec, [], kills);
    const medals = M.medalsOf(rec, kills, { chapters });
    // The round's best killer: most kills, the lower id on a tie.
    const tally = new Map();
    for (const k of scored) tally.set(k.killer, (tally.get(k.killer) ?? 0) + 1);
    const [best] = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    started = performance.now();
    const pids = [...new Set([...rec.players.keys(), ...(rec.playerNids?.keys() ?? [])])];
    for (const pid of pids) D.dossierOf(rec, pid, { kills, facts, medals, chapters });
    const everyoneMs = performance.now() - started;
    const d = D.dossierOf(rec, best, { kills, facts, medals, chapters });
    const grenades = [...facts].filter(([k, f]) => /grenade/i.test(k.weapon ?? '') && f.round).map(([, f]) => f.round.age);
    results.real[name] = {
      ms: Math.round(ms * 10) / 10,
      everyoneMs: Math.round(everyoneMs * 10) / 10,
      players: pids.length,
      fires: rec.fires.length,
      kills: scored.length,
      withRound: scored.filter(k => facts.get(k)?.round).length,
      withDistance: scored.filter(k => facts.get(k)?.distance !== null).length,
      facts: facts.size,
      kinds,
      grenadeAges: grenades.length ? [r2(Math.min(...grenades)), r2(Math.max(...grenades))] : null,
      best: { name: d.name, kills: d.summary.kills, deaths: d.summary.deaths, bestStreak: d.summary.bestStreak,
              favourite: d.summary.favourite?.weapon ?? null },
      top3: d.longest.slice(0, 3).map(r => [r2(r.t), r.victimName, r.weapon, r.distance, r.round?.kind ?? null]),
    };
    // RuppoPeaGame, shot 0.07 s after he got out of his Kubelwagen: placed
    // where the recording next has him, 6 m from the Sg44, not 459 m off
    // where he got in.
    const exit = kills.find(k => k.victim === 5 && Math.abs(k.t - 52.191) < 0.01);
    if (name === 'replay_20260928-133433' && exit) {
      const w = B.whereIs(rec, exit.victim, exit.t - 0.05);
      const kw = B.whereIs(rec, exit.killer, exit.t - 0.05);
      results.real[name].exit = {
        whereIs: { fresh: w.fresh, ground: Math.round(Math.hypot(w.pos[0] - kw.pos[0], w.pos[2] - kw.pos[2])) },
        fact: { distance: facts.get(exit).distance, fresh: facts.get(exit).fresh, round: brief(facts.get(exit).round) },
      };
    }
  }
}

process.stdout.write(JSON.stringify(results));
