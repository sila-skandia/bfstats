// Dogfights found in a recording (features/dogfight-recordings), on a
// recording written here row by row in the recorder's own format and read
// by the viewer's own reader. Prints one JSON blob for
// `test_dogfight_recordings.py`.
//
// The round: a Bf 109 (pid 2, Allies' enemy) flies a level circle, 300 m
// round, at 60 m/s, 500 m up. A Spitfire (pid 1) follows it round the same
// circle 25 degrees behind and fires aimed bursts from 10 s to 14 s, when
// the score says he shot it down. A second Spitfire (pid 3, pid 1's side)
// flies wide and fires at pid 1, a teammate. The Bf 109 sprays a burst
// straight up, at nobody. A jeep (pid 4) drives at 20 m/s, and a modded
// KettenKrad (pid 5) at 50 m/s. Only the first is a fight, and the
// KettenKrad is a plane only to the motion test: the catalogue says land.

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(HERE, '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const { parseRecording } = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);
const D = await import(pathToFileURL(path.join(viewer, 'dogfight-detect.js')).href);
const { recordedFight } = await import(pathToFileURL(path.join(viewer, 'dogfight-recorded.js')).href);

const DT = 0.1, END = 30, R = 300, V = 60, Y = 500;
const W = V / R; // radians a second
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;

/** A plane on the circle at angle `a` (recorded frame), heading along it. */
function onCircle(a, radius = R) {
  const p = [radius * Math.cos(a), Y, radius * Math.sin(a)];
  const vel = [-Math.sin(a), 0, Math.cos(a)];
  // Recorded nose for a yaw quaternion (0, sin(h/2), 0, cos(h/2)) is
  // (sin h, 0, cos h): heading h = atan2(vx, vz).
  const h = Math.atan2(vel[0], vel[2]);
  return { p, vel: vel.map(c => c * V), q: [0, Math.sin(h / 2), 0, Math.cos(h / 2)] };
}
const prey = t => onCircle(W * t);
const hunter = t => onCircle(W * t - 25 * Math.PI / 180);
const wing = t => onCircle(W * t + Math.PI, R + 900);
const jeep = t => ({ p: [2000 + 20 * t, 20, 0], q: [0, 0.7071, 0, 0.7071] });
const krad = t => ({ p: [-3000 + 50 * t, 30, 500], q: [0, 0.7071, 0, 0.7071] });
/** The model catalogue's word on each template (`extract_dogfights.mjs`). */
const CATALOGUE = { spitfire: true, bf109: true, willys: false, kettenkrad: false };
const air = tmpl => CATALOGUE[String(tmpl).toLowerCase()] ?? null;

const rows = [];
const row = o => rows.push(JSON.stringify(o));
row({ k: 'h', v: 5, plus: '2.0', start: '2026-11-07T10:00:00', hz: 10 });
row({ k: 'e', t: 0, e: 'setLevel', level: 'bf1942/levels/battle_of_britain/', mode: 'conquest.con' });
const players = [[1, 'Hunter', 2], [2, 'Prey', 1], [3, 'Wingman', 2], [4, 'Driver', 1], [5, 'Rider', 1]];
for (const [pid, name, team] of players) row({ k: 'e', t: 0, e: 'createPlayer', pid, name, team, ai: 0, netId: pid * 10, vehNetId: pid * 10, camNetId: pid * 10, kitNetId: 0 });
const objects = [[100, 'Spitfire', hunter], [200, 'BF109', prey], [300, 'Spitfire', wing], [400, 'Willys', jeep], [500, 'KettenKrad', krad]];
for (const [id, tmpl] of objects) row({ k: 'o', t: 0, id, tmpl, team: 0 });
row({ k: 'p', t: 0, p: [[1, 2, 100, 100, 0, 0], [2, 1, 200, 200, 0, 0], [3, 2, 300, 300, 0, 0], [4, 1, 400, 400, 0, 0], [5, 1, 500, 500, 0, 0]] });
for (let i = 0; i * DT <= END + 1e-9; i++) {
  const t = r3(i * DT);
  row({ k: 's', t, o: objects.map(([id, , at]) => { const s = at(t); return [id, ...s.p.map(r2), ...s.q.map(v => Math.round(v * 1e4) / 1e4)]; }) });
  // The hunter's aimed bursts: at the lead, the Bf 109 where the round
  // meets it.
  if (t >= 10 && t <= 14) {
    const me = hunter(t);
    let aim = prey(t).p;
    for (let k = 0; k < 3; k++) {
      const tof = Math.hypot(aim[0] - me.p[0], aim[1] - me.p[1], aim[2] - me.p[2]) / 400;
      aim = prey(t + tof).p;
    }
    // The round carries the plane's own velocity: aim off it.
    const tof = Math.hypot(aim[0] - me.p[0], aim[1] - me.p[1], aim[2] - me.p[2]) / 400;
    const d = [(aim[0] - me.p[0]) / tof - me.vel[0], (aim[1] - me.p[1]) / tof - me.vel[1], (aim[2] - me.p[2]) / tof - me.vel[2]];
    const n = Math.hypot(...d);
    row({ k: 'f', t, id: 100, pid: 1, w: 'SpitfireGuns', p: me.p.map(r2), d: d.map(c => r3(c / n)) });
  }
  // The wingman shoots at his own side; the prey shoots at the sky.
  if (t >= 5 && t <= 7) {
    const me = wing(t), at = hunter(t).p;
    const d = [at[0] - me.p[0], at[1] - me.p[1], at[2] - me.p[2]], n = Math.hypot(...d);
    row({ k: 'f', t, id: 300, pid: 3, w: 'SpitfireGuns', p: me.p.map(r2), d: d.map(c => r3(c / n)) });
  }
  if (t >= 12 && t <= 13) row({ k: 'f', t, id: 200, pid: 2, w: 'BF109Guns', p: prey(t).p.map(r2), d: [0, 1, 0] });
}
row({ k: 'e', t: 14, e: 'score', kind: 3, pid: 1, victim: 2, weaponName: 'SpitfireGuns' });
row({ k: 'end', t: END });

const rec = parseRecording(rows.join('\n'));
const planes = D.planesOf(rec, D.RULES, air);
const fights = D.findDogfights(rec, D.RULES, { air });
const out = {
  planes: planes.map(p => ({ tmpl: p.life.tmpl, pilots: p.pilots.map(x => x.pid) })),
  planesByMotion: D.planesOf(rec).map(p => p.life.tmpl),
  fights: fights.map(f => ({ t0: f.t0, t1: f.t1, kind: f.kind, mutual: f.mutual, closest: f.closest, kill: f.kill,
                             sides: f.sides.map(s => ({ name: s.name, tmpl: s.tmpl, team: s.team, aimed: s.aimed, turned: s.turned })) })),
};
if (fights.length) {
  const raw = { id: 'test-1', meta: { slug: 'test', level: 'battle_of_britain' }, ...D.sampleFight(rec, fights[0]) };
  const fight = recordedFight(raw);
  const tr = fight.tracks;
  const share = (s, test) => tr[s].filter(test).length / tr[s].length;
  out.raw = { dt: raw.dt, duration: raw.duration, shots: raw.shots.length, samples: raw.sides.map(s => s.p.length / 3), evidence: raw.evidence.length };
  out.fight = {
    lengths: tr.map(x => x.length), duration: fight.duration, end: fight.end, names: fight.names, planes: fight.planes,
    hunterOnTail: share(0, k => k.ph === 'offensive'), preyChased: share(1, k => k.ph === 'defensive'),
    hunterShot: share(0, k => k.o), preyShot: share(1, k => k.o),
    speed: [Math.min(...tr[0].map(k => k.v)), Math.max(...tr[0].map(k => k.v))],
    height: tr[0][0].p[1], hits: fight.hits, rounds: fight.rounds.length,
    kill: fight.events.filter(e => e.phase === 'kill').map(e => ({ t: e.t, side: e.side })),
    // The theatre's frame: z negated, the nose -z along the flight.
    noseAlongFlight: (() => {
      const k = tr[0][50], k2 = tr[0][51];
      const [x, y, z, w] = k.q;
      const nose = [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
      const v = [k2.p[0] - k.p[0], k2.p[1] - k.p[1], k2.p[2] - k.p[2]], n = Math.hypot(...v);
      return nose[0] * v[0] / n + nose[1] * v[1] / n + nose[2] * v[2] / n;
    })(),
  };
}
console.log(JSON.stringify(out));
