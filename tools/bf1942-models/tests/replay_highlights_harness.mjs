// The replay's highlights under node (features/round-replay-highlights): the
// streaks and medals, the battles, who stands apart, the Auto camera's
// director and the top plays, each read off a small recording written here
// line by line, so every case says exactly what happened. When the owner's
// real rounds are on disk (`viewer/replays`, untracked), the same model is
// also built from them and its headline findings reported.
//
// Same pattern as `replay_harness.mjs`: one node run, one JSON report, the
// modules imported from the viewer tree in place through `sim/env.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [R, C, B, M, { ReplayDirector }, H, SL] = await Promise.all([
  imp('replay-recording.js'), imp('replay-chapters.js'), imp('replay-battles.js'), imp('replay-medals.js'),
  imp('replay-director.js'), imp('replay-highlights.js'), imp('replay-server-log.js'),
]);

const results = {};

/** A recording from its lines: `L({...})` writes one. */
function recording(build) {
  const lines = [];
  build(o => lines.push(JSON.stringify(o)));
  return R.parseRecording(lines.join('\n'));
}

/** A soldier made, replicated and sampled at `pos` (BF1942's frame). */
function soldier(L, t, nid, pid, team, pos, tmpl = team === 1 ? 'GermanSoldier' : 'USSoldier') {
  L({ k: 'e', t, e: 'createObject', netId: nid, tmpl, tid: 1700 + team, pos, rot: [0, 0, 0] });
  L({ k: 'o', t, id: nid, tmpl, tid: 1700 + team, team, maxhp: 30 });
  L({ k: 's', t, o: [[nid, pos[0], pos[1] + 1, pos[2], 0, 0, 0, 1]] });
  L({ k: 'p', t, p: [[pid, team, nid]] });
}
const kill = (L, t, killer, victim, weapon) => L({ k: 'e', t, e: 'score', kind: 3, pid: killer, victim, weaponName: weapon });
const player = (L, pid, name, team) => L({ k: 'e', t: 0.2, e: 'createPlayer', pid, name, team, ai: 1 });
const shots = (L, from, to, every, pid, nid, pos, dir, weapon = 'Mp40') => {
  for (let t = from; t <= to + 1e-9; t += every) L({ k: 'f', t: +t.toFixed(3), pid, id: nid, w: weapon, p: pos, d: dir });
};

// --- streaks, medals and the leader -----------------------------------------------
//
// A1 (Axis) kills B1, B2 and B3 at 10, 13 and 17 s: first blood, a double,
// a triple and a killing spree in one play, and the kill lead. B1, back
// from his spawn, kills him at 30 s: a shutdown of his three, and revenge.
// A2 knifes B1 at 40 s. B2 shoots A2 from 150 m at 50 s: a long shot. B3's
// landmine kills A1 200 m off at 60 s: no long shot, a mine is not aimed.
{
  const rec = recording(L => {
    L({ k: 'h', v: 5, start: '', hz: 10 });
    for (const [pid, name, team] of [[1, 'A1', 1], [2, 'A2', 1], [3, 'B1', 2], [4, 'B2', 2], [5, 'B3', 2]]) player(L, pid, name, team);
    L({ k: 'e', t: 0.5, e: 'gameStatus', status: 3 });
    L({ k: 'e', t: 1, e: 'gameStatus', status: 1 });
    soldier(L, 1, 100, 1, 1, [0, 0, 0]);
    soldier(L, 1, 101, 2, 1, [150, 0, 0]);
    soldier(L, 1, 200, 3, 2, [10, 0, 0]);
    soldier(L, 1, 201, 4, 2, [12, 0, 0]);
    soldier(L, 1, 202, 5, 2, [14, 0, 0]);
    kill(L, 10, 1, 3, 'Mp40');
    kill(L, 13, 1, 4, 'Mp40');
    kill(L, 17, 1, 5, 'Mp40');
    soldier(L, 20, 210, 3, 2, [5, 0, 0]);
    soldier(L, 20, 211, 4, 2, [0, 0, 0]);
    soldier(L, 20, 212, 5, 2, [0, 0, 200]);
    kill(L, 30, 3, 1, 'Thompson');
    soldier(L, 35, 110, 1, 1, [0, 0, 5]);
    kill(L, 40, 2, 3, 'KnifeAxis');
    kill(L, 50, 4, 2, 'K98Sniper');
    kill(L, 60, 5, 1, 'Landmine');
    L({ k: 's', t: 61, o: [] });
  });
  const medals = M.medalsOf(rec, rec.kills);
  const streaks = M.streaksOf(rec.kills);
  const leaders = M.leadersOf(rec.kills);
  results.medals = {
    list: medals.map(m => [+m.t.toFixed(2), rec.players.get(m.pid)?.name, m.kind, m.label, m.count ?? m.ended ?? m.distance ?? null]),
    describe: medals.filter(m => ['multi', 'shutdown', 'longshot'].includes(m.kind)).map(m => M.describeMedal(m, rec)),
    streakA1: [5, 10, 13, 17, 29, 31].map(t => M.streakAt(streaks, 1, t)),
    bestA1: M.bestStreakAt(streaks, 1, 59),
    leader: [9, 17, 31].map(t => M.leaderAt(leaders, t)?.pid ?? null),
    plays: M.topPlays(medals).map(p => [rec.players.get(p.pid)?.name, p.title, p.medals.map(m => m.kind).sort()]),
  };
  // A recording that joined mid-round has no first blood to give.
  const joined = recording(L => {
    L({ k: 'h', v: 5 });
    player(L, 1, 'A1', 1);
    player(L, 3, 'B1', 2);
    L({ k: 'e', t: 0.5, e: 'gameStatus', status: 1 });
    soldier(L, 1, 100, 1, 1, [0, 0, 0]);
    soldier(L, 1, 200, 3, 2, [10, 0, 0]);
    kill(L, 10, 1, 3, 'Mp40');
  });
  results.medals.joinedFirstBlood = M.medalsOf(joined, joined.kills).some(m => m.kind === 'firstblood');
}

// --- battles ----------------------------------------------------------------------------
//
// Two men trade fire at (100..130, 0, 100) from 5 to 15 s, and the Allied
// one dies: one contested battle there. Another Axis man shoots alone at
// (600, 0, 600) from 5 to 45 s: gunfire, not a battle. A beached landing
// craft loses 5 points every half-second (no fight), a tank takes one big
// hit (the Axis side's fire).
{
  const rec = recording(L => {
    L({ k: 'h', v: 5 });
    player(L, 1, 'Axis rifle', 1);
    player(L, 2, 'Allied rifle', 2);
    player(L, 3, 'Axis sniper', 1);
    soldier(L, 1, 100, 1, 1, [100, 0, 100]);
    soldier(L, 1, 200, 2, 2, [130, 0, 100]);
    soldier(L, 1, 101, 3, 1, [600, 0, 600]);
    shots(L, 5, 15, 0.25, 1, 100, [100, 1.6, 100], [1, 0, 0]);
    shots(L, 5, 14.5, 0.25, 2, 200, [130, 1.6, 100], [-1, 0, 0], 'Thompson');
    kill(L, 15, 1, 2, 'Mp40');
    shots(L, 5, 45, 0.5, 3, 101, [600, 1.6, 600], [0, 0, 1], 'K98');
    L({ k: 'e', t: 1, e: 'createObject', netId: 300, tmpl: 'Daihatsu', tid: 900, pos: [400, 0, 400], rot: [0, 0, 0] });
    L({ k: 'o', t: 1, id: 300, tmpl: 'Daihatsu', tid: 900, team: 0, maxhp: 150, crit: 50 });
    L({ k: 's', t: 1, o: [[300, 400, 0, 400, 0, 0, 0, 1]] });
    L({ k: 'e', t: 1, e: 'createObject', netId: 301, tmpl: 'Sherman', tid: 901, pos: [700, 0, 100], rot: [0, 0, 0] });
    L({ k: 'o', t: 1, id: 301, tmpl: 'Sherman', tid: 901, team: 2, maxhp: 100, crit: 12 });
    L({ k: 's', t: 1, o: [[301, 700, 0, 100, 0, 0, 0, 1]] });
    L({ k: 'a', t: 1, a: [[300, 150], [301, 100]] });
    for (let i = 1; i <= 20; i++) L({ k: 'a', t: 20 + i * 0.5, a: [[300, 150 - 5 * i]] });
    L({ k: 'a', t: 22, a: [[301, 60]] });
    L({ k: 's', t: 50, o: [] });
  });
  const activity = B.activityOf(rec, rec.kills);
  const battles = B.battlesOf(activity, rec.duration);
  const at = (t, x, z) => B.battlesAt(battles, t).find(b => Math.hypot(b.s.pos[0] - x, b.s.pos[2] - z) < 60) ?? null;
  const fight = at(12, 115, -100);
  const lone = at(30, 600, -600);
  results.battles = {
    kinds: Object.fromEntries(['shot', 'kill', 'hullHit', 'wreck', 'hit'].map(k => [k, activity.filter(e => e.kind === k).length])),
    drainEvents: activity.filter(e => e.life?.nid === 300).length,
    tankHitTeam: activity.find(e => e.life?.nid === 301)?.team ?? null,
    fight: fight && {
      contested: B.contested(fight.s), pids: [...fight.s.pids].sort(),
      pos: fight.s.pos.map(v => Math.round(v)), trackKills: fight.track.kills,
      place: B.placeName(fight.s.pos, []),
    },
    lone: lone && { contested: B.contested(lone.s), pids: lone.s.pids },
    fightOver: at(40, 115, -100) === null,
    distinct: fight && lone ? fight.track.id !== lone.track.id : null,
    compass: [B.compass(0, -1), B.compass(1, 0), B.compass(0, 1), B.compass(-1, -1)],
    places: [
      B.placeName([10, 0, -10], [{ name: 'Village', pos: [0, 0, 0] }], n => n.replace(/_/g, ' ')),
      B.placeName([0, 0, -200], [{ name: 'Landing_Beach', pos: [0, 0, 0] }], n => n.replace(/_/g, ' ')),
      B.placeName([0, 0, -900], [{ name: 'Village', pos: [0, 0, 0] }]),
    ],
    intensityPeak: (() => {
      const { total } = B.intensityOf(activity, rec.duration, 1);
      let best = 0;
      for (let i = 0; i < total.length; i++) if (total[i] > total[best]) best = i;
      return best;
    })(),
  };
}

// --- the vehicles ------------------------------------------------------------------------------
//
// T1 drives a Tiger and kills with it at 10 s; his gunner sits in its seat
// 1. An empty Sherman stands by. The Tiger is destroyed at 20 s.
{
  const rec = recording(L => {
    L({ k: 'h', v: 5 });
    player(L, 1, 'T1', 1);
    player(L, 2, 'Gunner', 1);
    player(L, 3, 'V', 2);
    for (const [nid, tmpl, pos] of [[500, 'Tiger', [0, 0, 0]], [510, 'Sherman', [300, 0, 0]]]) {
      L({ k: 'e', t: 1, e: 'createObject', netId: nid, tmpl, tid: 960, pos, rot: [0, 0, 0] });
      L({ k: 'o', t: 1, id: nid, tmpl, tid: 960, team: 0, maxhp: 100 });
      L({ k: 's', t: 1, o: [[nid, ...pos, 0, 0, 0, 1]] });
    }
    L({ k: 'a', t: 1, a: [[500, 100]] });
    L({ k: 'p', t: 1, p: [[1, 1, 500, 500, 0], [2, 1, 501, 500, 1]] });
    soldier(L, 1, 200, 3, 2, [60, 0, 0]);
    kill(L, 10, 1, 3, 'Tiger');
    L({ k: 'a', t: 15, a: [[500, 40]] });
    L({ k: 'a', t: 20, a: [[500, 0]] });
    L({ k: 's', t: 25, o: [] });
  });
  const hullKills = B.hullKillsOf(rec, rec.kills);
  const at = t => B.vehiclesAt(rec, t, hullKills).map(v => ({ tmpl: v.life.tmpl, crew: v.crew.map(c => [c.pid, c.seat]), kills: v.kills, hp: v.hp }));
  results.vehicles = { at5: at(5), at16: at(16), at21: at(21) };
}

// --- who is where, and who stands apart ----------------------------------------------------
//
// L1 (Axis) is 200 m from his side with an Allied man 80 m off: a lone
// wolf. P1 (Axis) stands at a flag the Allies hold with nobody of his near:
// behind enemy lines. F1 (Axis) is 3 km from everything while a fight burns:
// far from the fight, once he is 20 s past his spawn. Z1 (Axis) flies a
// Zero alone: a pilot is none of these. G1 goes out of range at 12 s.
{
  const rec = recording(L => {
    L({ k: 'h', v: 5 });
    for (const [pid, name, team] of [[1, 'L1', 1], [2, 'E1', 2], [3, 'M1', 1], [4, 'P1', 1], [5, 'F1', 1], [6, 'Z1', 1],
      [7, 'S1', 1], [8, 'S2', 2], [9, 'G1', 2]]) player(L, pid, name, team);
    soldier(L, 1, 100, 1, 1, [1000, 0, 1000]);
    soldier(L, 1, 200, 2, 2, [1080, 0, 1000]);
    soldier(L, 1, 101, 3, 1, [1200, 0, 1000]);
    L({ k: 'cp', t: 1, id: 1, tmpl: 'cp_enemy', name: 'Enemy_Flag', team: 2, pos: [2000, 0, 2000] });
    soldier(L, 1, 102, 4, 1, [2030, 0, 2000]);
    soldier(L, 1, 103, 5, 1, [3000, 0, 3000]);
    L({ k: 'e', t: 1, e: 'createObject', netId: 400, tmpl: 'Zero', tid: 950, pos: [4000, 200, 4000], rot: [0, 0, 0] });
    L({ k: 'o', t: 1, id: 400, tmpl: 'Zero', tid: 950, team: 1, maxhp: 100 });
    L({ k: 's', t: 1, o: [[400, 4000, 200, 4000, 0, 0, 0, 1]] });
    L({ k: 'p', t: 1, p: [[6, 1, 400]] });
    // A fight far from all of them, to be far from.
    soldier(L, 1, 104, 7, 1, [0, 0, 0]);
    soldier(L, 1, 201, 8, 2, [20, 0, 0]);
    shots(L, 2, 40, 0.5, 7, 104, [0, 1.6, 0], [1, 0, 0]);
    shots(L, 2, 40, 0.5, 8, 201, [20, 1.6, 0], [-1, 0, 0]);
    soldier(L, 1, 202, 9, 2, [500, 0, 500]);
    L({ k: 'd', t: 12, id: 202 });
    L({ k: 's', t: 45, o: [] });
  });
  const activity = B.activityOf(rec, rec.kills);
  const battles = B.battlesOf(activity, rec.duration);
  const kindOf = life => (life?.tmpl === 'Zero' ? 'air' : null);
  const standouts = B.standoutsOf(rec, battles, { kindOf });
  const kind = (pid, t) => B.standoutAt(standouts, pid, t)?.kind ?? null;
  // Read a few seconds at a time, as the page reads it between frames
  // (`standoutSteps`): the same timeline, after as many pauses as chunks.
  const steps = B.standoutSteps(rec, battles, { kindOf, chunk: 4 });
  let pauses = 0;
  let stepped = null;
  for (;;) {
    const { done, value } = steps.next();
    if (done) { stepped = value; break; }
    pauses += 1;
  }
  const flat = m => JSON.stringify([...m].sort((a, b) => a[0] - b[0]));
  const g = t => {
    const w = B.whereIs(rec, 9, t);
    return { fresh: w.fresh, pos: w.pos && w.pos.map(v => Math.round(v)), seen: w.seen };
  };
  results.standouts = {
    stepped: { same: flat(stepped) === flat(standouts), pauses, seconds: Math.floor(rec.duration) },
    lone: [3, 10].map(t => kind(1, t)),
    loneDetail: B.standoutAt(standouts, 1, 10)?.detail ?? null,
    behind: kind(4, 10),
    behindDetail: B.standoutAt(standouts, 4, 10)?.detail ?? null,
    far: [10, 30].map(t => kind(5, t)),
    pilot: [10, 30].map(t => kind(6, t)),
    fighting: [10, 30].map(t => kind(7, t)),
    ghost: [g(5), g(20), g(40)],
    heading: [
      B.headingAt({ soldier: false, keys: [{ t: 0, p: [0, 0, 0], q: [0, 0, 0, 1] }] }, 0).map(v => +v.toFixed(3)),
      B.headingAt({ soldier: true, keys: [{ t: 0, p: [0, 0, 0], q: [0, 0, 0, 1] }] }, 0).map(v => +v.toFixed(3)),
      // A quarter turn about +Y (BF1942's frame).
      B.headingAt({ soldier: false, keys: [{ t: 0, p: [0, 0, 0], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }] }, 0).map(v => +v.toFixed(3)),
      B.headingAt({ soldier: true, keys: [{ t: 0, p: [0, 0, 0], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }] }, 0).map(v => +v.toFixed(3)),
    ],
  };
}

// --- the director -----------------------------------------------------------------------------
//
// Q1 (the recording player) stands idle all round. Q2 kills X at 10 s, then
// Y kills Q2 at 20 s. The director starts on Q1 (nobody is doing anything),
// cuts to Q2 once its six seconds are up and his kill is coming, stays on
// Q2's body after he dies, then goes to Y, who killed him.
{
  const rec = recording(L => {
    L({ k: 'h', v: 5 });
    for (const [pid, name, team] of [[1, 'Q1', 1], [2, 'Q2', 1], [3, 'X', 2], [4, 'Y', 2]]) player(L, pid, name, team);
    L({ k: 'f', t: 0.1, pid: 1, id: 100, w: 'K98', p: [0, 1.6, 0], d: [0, 0, 1], local: 1 });
    soldier(L, 1, 100, 1, 1, [0, 0, 0]);
    soldier(L, 1, 101, 2, 1, [300, 0, 0]);
    soldier(L, 1, 200, 3, 2, [330, 0, 0]);
    soldier(L, 1, 201, 4, 2, [340, 0, 20]);
    shots(L, 8, 10, 0.25, 2, 101, [300, 1.6, 0], [1, 0, 0]);
    kill(L, 10, 2, 3, 'Mp40');
    shots(L, 17, 20, 0.25, 4, 201, [340, 1.6, 20], [-1, 0, -1], 'Thompson');
    kill(L, 20, 4, 2, 'Thompson');
    L({ k: 's', t: 40, o: [] });
  });
  const kills = rec.kills;
  const model = H.buildModel(rec, { kills, chapters: C.buildChapters(rec, [], kills) });
  const director = new ReplayDirector(model, { fallback: C.recordingPlayer(rec) });
  const picks = [];
  let current = null;
  for (let i = 0; i <= 35 * 20; i++) {
    const t = i / 20;
    const d = director.update(t, current);
    if (d.pid !== current) {
      picks.push([+t.toFixed(2), rec.players.get(d.pid)?.name, d.reason]);
      current = d.pid;
    }
  }
  results.director = { picks };
  // After a seek it chooses afresh, with no dwell to wait out.
  director.update(5, 1);
  results.director.afterSeek = director.update(30, 1).pid;
  // The viewer follows Q2 himself at 15 s: the director starts from him, and
  // when he dies holds on his body, then goes to his killer.
  const held = new ReplayDirector(model, { fallback: 1 });
  held.update(14.9, null);
  let pick = 2;
  const death = [];
  for (let i = 15 * 20; i <= 26 * 20; i++) {
    const t = i / 20;
    const d = held.update(t, pick);
    if (d.pid !== pick || i === 15 * 20) death.push([+t.toFixed(2), rec.players.get(d.pid)?.name, d.reason]);
    pick = d.pid;
  }
  results.director.death = death;
  results.director.interestDead = held.interest(2, 21).score === -Infinity;
}

// --- the owner's rounds, where they are on disk ------------------------------------------------
{
  const rounds = [
    ['replays/20260927-075736-wake-coop/replay_20260927-075756.ndjson', 'replays/20260927-075736-wake-coop/ev_14568-20260927_0757.xml'],
    ['replays/20260927-140921-kursk-conquest/replay_20260927-140921.ndjson', null],
  ];
  results.rounds = {};
  for (const [file, logFile] of rounds) {
    const full = path.join(viewer, file);
    if (!fs.existsSync(full)) continue;
    const rec = R.parseRecording(fs.readFileSync(full, 'utf8'));
    let serverRows = [];
    if (logFile && fs.existsSync(path.join(viewer, logFile))) {
      const log = SL.parseServerLog(fs.readFileSync(path.join(viewer, logFile), 'utf8'));
      const alignment = SL.alignServerLog(rec, log);
      if (alignment) serverRows = SL.serverRows(rec, log, alignment);
    }
    const kills = C.killsOf(rec, serverRows);
    const started = performance.now();
    const model = H.buildModel(rec, { kills, chapters: C.buildChapters(rec, serverRows, kills), serverRows });
    const ms = performance.now() - started;
    const name = pid => rec.players.get(pid)?.name ?? `player ${pid}`;
    const points = B.pointsOf(rec);
    const top = [...model.battles].sort((a, b) => b.peak - a.peak).slice(0, 3);
    results.rounds[path.basename(file, '.ndjson')] = {
      ms: Math.round(ms),
      kills: kills.length,
      placed: model.activity.filter(e => e.kind === 'kill').length,
      battles: model.battles.length,
      contested: model.battles.filter(b => b.contested).length,
      hottest: top.map(b => B.placeName(b.samples.find(s => s.t === b.peakT).pos, points)),
      medals: model.medals.map(m => [+m.t.toFixed(1), name(m.pid), m.label]),
      plays: model.plays.map(p => [+p.t0.toFixed(1), name(p.pid), p.title]),
    };
  }
}

process.stdout.write(JSON.stringify(results));
