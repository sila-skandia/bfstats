// Tank fights found in a recording (features/battle-schools, "Tank fights
// from the recordings"), on a round written here row by row in the
// recorder's own format and read by the viewer's own reader. Prints one JSON
// blob for `test_tank_fights.py`.
//
// The round: a Sherman (pid 1, Allies, 100 hit points) stands at the origin.
// A Tiger (pid 2, Axis, 125) drives north at 3 m/s 300 m east of it. The
// Sherman fires three shells at the Tiger, each led and held over for a
// 100 m/s shell falling at 14.73 m/s^2, at 10, 14 and 18 s; each takes the
// Tiger's hit points down (125, 80, 40, 0) and the score credits the kill to
// the Sherman. Between them the Sherman fires a shell straight up (16 s) and
// the Tiger one straight away from it (12 s): neither is aimed. A Willys
// (pid 3, Axis) parked 50 m from the Sherman is shot at too (13 s): a jeep
// is no tank. Variants: the Tiger opening hurt (100 of 125), and a round
// with no kill where the Tiger's driver gets out at 17 s.

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const { parseRecording } = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);
const D = await import(pathToFileURL(path.join(viewer, 'tank-fights-detect.js')).href);

const DT = 0.1, END = 30, G = 14.73, SPEED = 100;
const r2 = v => Math.round(v * 100) / 100;
const r4 = v => Math.round(v * 1e4) / 1e4;

const sherman = () => [0, 0, 0];
const tiger = t => [300, 0, 3 * t];
const willys = () => [50, 0, -20];
const MUZZLE = [0, 2, 0];
/** The caller's tank test (`extract_tank_fights.mjs` asks the AI data). */
const TANKS = { sherman: { hpMax: 100 }, tiger: { hpMax: 125 } };
const tank = tmpl => TANKS[String(tmpl).toLowerCase()] ?? null;

/** The bore for a shell fired at `t` to meet the Tiger's hull (1 m up). */
function lead(t) {
  let tof = 3;
  let d = null;
  for (let k = 0; k < 20; k++) {
    const p = tiger(t + tof);
    const want = [p[0] - MUZZLE[0], p[1] + 1 + 0.5 * G * tof * tof - MUZZLE[1], p[2] - MUZZLE[2]];
    tof = Math.hypot(...want) / SPEED;
    d = want.map(v => v / tof / SPEED);
  }
  return { dir: d, tof };
}

function round({ hurt = false, leave = false } = {}) {
  const rows = [];
  const row = o => rows.push(JSON.stringify(o));
  row({ k: 'h', v: 5, plus: '2.0', start: '2026-11-09T10:00:00', hz: 10 });
  row({ k: 'e', t: 0, e: 'setLevel', level: 'bf1942/levels/kursk/', mode: 'conquest.con' });
  for (const [pid, name, team] of [[1, 'Gunner', 2], [2, 'Panzer', 1], [3, 'Jeep', 1]]) {
    row({ k: 'e', t: 0, e: 'createPlayer', pid, name, team, ai: 0, netId: pid * 10, vehNetId: pid * 10, camNetId: pid * 10, kitNetId: 0 });
  }
  const objects = [[100, 'Sherman', sherman, 100], [200, 'Tiger', tiger, 125], [300, 'Willys', willys, 50]];
  for (const [id, tmpl, , maxhp] of objects) row({ k: 'o', t: 0, id, tmpl, team: 0, maxhp });
  row({ k: 'a', t: 0, a: [[100, 100], [200, hurt ? 100 : 125], [300, 50]] });
  const shots = [];
  const hp = [];
  for (const [i, t] of (leave ? [10, 14] : [10, 14, 18]).entries()) {
    const { dir, tof } = lead(t);
    shots.push({ t, dir, tof });
    const after = [hurt ? 60 : 80, 40, 0][i];
    hp.push({ t: r2(t + tof + 0.2), hp: after });
  }
  for (let i = 0; i * DT <= END + 1e-9; i++) {
    const t = Math.round(i * DT * 1000) / 1000;
    const seats = [[1, 2, 100, 100, 0]];
    if (!(leave && t >= 17)) seats.push([2, 1, 200, 200, 0]);
    else seats.push([2, 1, 20, -1, 0]);
    seats.push([3, 1, 300, 300, 0]);
    if (Math.abs(t % 2) < 1e-6) row({ k: 'p', t, p: seats });
    if (leave && Math.abs(t - 17) < 1e-6) row({ k: 'p', t, p: [[2, 1, 20, -1, 0]] });
    row({ k: 's', t, o: objects.map(([id, , at]) => [id, ...at(t).map(r2), 0, 0, 0, 1]) });
    for (const s of shots) if (Math.abs(s.t - t) < 1e-6) row({ k: 'f', t, id: 100, pid: 1, w: 'ShermanGunBarrel', p: MUZZLE, d: s.dir.map(r4) });
    if (Math.abs(t - 16) < 1e-6) row({ k: 'f', t, id: 100, pid: 1, w: 'ShermanGunBarrel', p: MUZZLE, d: [0, 1, 0] });
    if (Math.abs(t - 12) < 1e-6) row({ k: 'f', t, id: 200, pid: 2, w: 'TigerGunBarrel', p: [300, 2, 36], d: [1, 0, 0] });
    if (Math.abs(t - 13) < 1e-6) {
      const w = willys(), d = [w[0] - MUZZLE[0], w[1] + 1 - MUZZLE[1], w[2] - MUZZLE[2]], n = Math.hypot(...d);
      row({ k: 'f', t, id: 100, pid: 1, w: 'ShermanGunBarrel', p: MUZZLE, d: d.map(v => r4(v / n)) });
    }
    for (const h of hp) if (Math.abs(h.t - t) < 0.05) row({ k: 'a', t, a: [[200, h.hp]] });
  }
  if (!leave) row({ k: 'e', t: r2(shots[2].t + shots[2].tof + 0.1), e: 'score', kind: 3, pid: 1, victim: 2, weaponName: 'Sherman' });
  row({ k: 'end', t: END });
  return { rec: parseRecording(rows.join('\n')), shots };
}

const fightOut = f => ({
  t0: f.t0, t1: f.t1, end: f.end, winner: f.winner, range: f.range, rangeHow: f.rangeHow, fullHpStart: f.fullHpStart,
  upset: f.upset, mutual: f.mutual, score: D.scoreOf(f), kill: f.kill,
  sides: f.sides.map(s => ({ name: s.name, tmpl: s.tmpl, team: s.team, weight: s.weight, hpStart: s.hpStart, hpMax: s.hpMax,
                             shots: s.shots, aimed: s.aimed, hits: s.hits })),
});

const main = round();
const fights = D.findTankFights(main.rec, D.RULES, { tank });
const out = {
  tanks: D.tanksOf(main.rec, D.RULES, tank).map(T => ({ tmpl: T.life.tmpl, weight: T.weight, drivers: T.drivers.map(d => d.pid), shots: T.shots.length })),
  fights: fights.map(fightOut),
  // Where the killing shell left, and where the Tiger was then.
  killShot: (() => {
    const s = main.shots[2], p = tiger(s.t);
    return { t: s.t, range: Math.hypot(p[0] - MUZZLE[0], p[1] + 1 - MUZZLE[1], p[2] - MUZZLE[2]) };
  })(),
  weights: [0, 50, 99, 100, 124, 125, 166].map(hp => D.weightOf(hp)).concat(D.weightOf(110, 'LightArmour')),
  mainGun: ['ShermanGunBarrel', 'M36GunBarrelAP', 'PanzerIILcannon', 'Coaxial_MG34', 'AA_Allies_GunBarrel', 'WespeTracGunBarrel', 'Mg34V', 'L3_33_20mmMG']
    .map(w => [w, D.isMainGunShot(w)]),
};
if (fights.length) {
  const sampled = D.sampleTankFight(main.rec, fights[0]);
  out.sampled = { dt: sampled.dt, duration: sampled.duration, samples: sampled.sides.map(s => s.p.length / 3),
    hp: sampled.sides.map(s => s.hp), shots: sampled.shots.map(s => ({ side: s.side, aimed: s.aimed, hit: s.hit ?? null })), yaw: sampled.sides.map(s => s.yaw[0]),
    attitude: sampled.sides.map(s => [s.pitch.length, s.roll.length, s.pitch[0], s.roll[0]]),
    hitShotT: sampled.evidence.filter(e => e.kind === 'hit').map(e => e.shotT) };
}
out.hurt = D.findTankFights(round({ hurt: true }).rec, D.RULES, { tank }).map(fightOut);
out.left = D.findTankFights(round({ leave: true }).rec, D.RULES, { tank }).map(fightOut);
// Without the tank test: whatever fires a main gun with 100 hit points.
out.untested = D.tanksOf(main.rec).map(T => T.life.tmpl);
process.stdout.write(JSON.stringify(out));
