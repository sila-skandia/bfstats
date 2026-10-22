// Does the server's soldier slide down a steep terrain slope with no input?
// A copy of move_law_probe.mjs (same log format: move_law_check.py reads it,
// tests/slope_slide_harness.mjs replays it through the page) that steers a sidecar soldier
// on vanilla Wake, closed loop on the server's own control state, to the foot
// of terrain faces, runs straight up (or walks down) each, releases
// W on the face and logs the server's soldier per ack for five seconds
// standing, then three crouched, then two standing again.
//
//   NAME=slope1234 node lab/slope_slide_probe.mjs 127.0.0.1:14568 slope.ndjson
//
// The faces (server frame, picked from Wake's heightmap with move_law_terrain):
//   A  ~32 deg, uphill -x: along the shore to (1520, 686), up, release at (1508, 684.0)
//   B  ~39 deg, uphill -x+z: along the shore to (1518.8, 653.5), up, release at (1497.5, 661.5)
//   C  ~28 deg (a 21 deg run-in), uphill -x-2z, east of South Base: release at (1062.4, 826.5)
//   D  ~43 deg, uphill -x-z, South Base's shore: release at (1041.6, 879.5)
//      (the server's soldier cannot climb it: he is pushed back off it)
//   E  D's upper ~38.5 deg, walked down from its crest: release at (1039.0, 877.4)
//   F  D's ~43 deg, walked on down from E: release at (1043.0, 880.2)
//   G1 North Base's ~31 deg east face, walked down from its crest: (1364.5, 1202)
//   G2 the same face run up from the shore
//   H1 ~40.5 deg, walked down from the crest at z 1120: (1362.5, 1120)
//   H2 ~42 deg, walked on down from H1: (1366, 1120); H3 the same run up
//   I1 / I2 run / walk up North Base's south shore at x 1265, over a 46.5 deg
//      band, W held five / ten seconds then released
// (the foot of each is the waterline, 95 m: the run-in comes along the shore).
// A spawn farther than 200 m from the first face is suicided and retried with
// the next group: the groups team 2 holds change with the round.
// Steering is the look axis: a moving soldier's body turns 3 deg per unit of
// lookX a tick (lab/look_law_check.py), so lookX = heading error / 3, capped.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, actionFor } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, ms: Date.now() - T0, ...rec }) + '\n');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = process.env.NAME ?? `slope${Date.now() % 10000}`;
const TEAM = 2;
const KIT = Number(process.env.KIT ?? 0);
const FACES = (process.env.FACES ?? 'C,D').split(',');

// Each face: waypoints run in order (`walk` for the slow gait), then the last
// leg from where the soldier is toward `release`, letting go of W the tick he
// passes it. Faces run in the order given and each starts where the last ended.
const FACE = {
  A: { legs: [[1518, 677, 2], [1520, 686, 1]], release: [1508, 684.0] },
  B: { legs: [[1514, 646, 2], [1518.8, 653.5, 1]], release: [1497.5, 661.5] },
  C: { legs: [[1074.5, 839.8, 2], [1070, 842.3, 1]], release: [1062.4, 826.5] },
  D: { legs: [[1044.0, 888.5, 2], [1047.4, 883.6, 1]], release: [1041.6, 879.5] },
  // from C's top along the ridge to D's crest, then walked DOWN the face
  E: { legs: [[1046, 845, 2], [1031, 868, 1.5], [1031.5, 872.5, 1]], release: [1039.0, 877.4], walk: true },
  F: { legs: [], release: [1043.0, 880.2], walk: true },
  // North Base's east shore (z 1202): a 31 deg face under a flat crest
  G1: { legs: [[1350, 1202, 1]], release: [1364.5, 1202], walk: true },
  G2: { legs: [[1386, 1202, 1.5]], release: [1364.5, 1202] },
  // z 1120: 30.6 deg, then 40.5..42.1 deg, under a flat crest
  H1: { legs: [[1352, 1150, 2], [1350, 1120, 1]], release: [1362.5, 1120], walk: true },
  H2: { legs: [], release: [1366, 1120], walk: true },
  H3: { legs: [[1384, 1120, 1.5]], release: [1366, 1120] },
  // North Base's south shore at x 1265: flat, 28, 32, 22, then a 46.5..47 deg
  // band (z 1164..1168), 35, 41, 24 deg, flat on top. Run (I1) and walk (I2)
  // straight up it, holding W for five seconds whether he gets there or not:
  // where he slows, where he stalls, and what he does when he lets go.
  I1: { legs: [[1257, 1151, 1.5], [1265, 1150, 1]], release: [1265.8, 1176], push: 150 },
  I2: { legs: [[1257, 1151, 1.5], [1265, 1150, 1]], release: [1265.8, 1176], push: 300, walk: true },
};

const s = new Session(host, Number(portStr), { name: NAME, team: TEAM });
let spawned = false;
let dead = false;
let ctrl = 0;
const me = { pos: null, rot: null, vel: null };
s.on('control-state', (c) => {
  ctrl++;
  if (c.cls === 'BFSoldierNetworkable') {
    if (c.body?.pos) me.pos = c.body.pos;
    if (c.body?.rot) me.rot = c.body.rot;
    if (c.body?.vel) me.vel = c.body.vel;
  }
  log('cs', { ok: c.ok, tick: c.tick, seq: c.seq, serial: c.controlId ?? null, cls: c.cls,
    pos: c.body?.pos ?? null, rot: c.body?.rot ?? null, vel: c.body?.vel ?? null,
    aimA: c.body?.aimA ?? null, aimB: c.body?.aimB ?? null, mask: c.body?.mask ?? null });
});
s.on('event', (ev) => {
  if ((ev.type === 'SetVehicle' || ev.type === 'SetDefaultVehicle') && ev.playerId === s.me.playerId && ev.netId) spawned = true;
  if (ev.type === 'PlayerDeath' || ev.type === 'Death') { if (ev.playerId === s.me.playerId) { dead = true; log('dead', {}); } }
});
const joined = new Promise((r) => s.once('joined', r));
await s.start();
log('joined', await joined);
const sender = new InputSender(s, { idle: 'zero' });
sender.on('sent', (e) => { if (!e.idle) log('sent', { serial: e.serial, axes: e.action.axes, buttons: e.action.buttons }); });
sender.start();

const GROUPS = [3, 2, 1, 4, 5];
const first = FACE[FACES[0]].legs[0] ?? FACE[FACES[0]].release;
let tries = 0;
for (let round = 0; round < 6; round++) {
  for (; !spawned && tries < 60; tries++) {
    await spawnSequence(s, { team: TEAM, kit: KIT, spawnGroup: GROUPS[tries % GROUPS.length] });
    for (let k = 0; k < 30 && !spawned; k++) await delay(100);
  }
  if (!spawned) { log('noSpawn'); console.log('no spawn'); process.exit(1); }
  me.pos = null;
  for (let k = 0; k < 100 && !me.pos; k++) await delay(100);
  const far = me.pos ? Math.hypot(me.pos[0] - first[0], me.pos[2] - first[1]) : Infinity;
  if (far < 200) break;
  log('farSpawn', { pos: me.pos, far });
  console.log('spawned', Math.round(far), 'm away; suicide');
  s.queue('Suicide', {});
  spawned = false;
  await delay(6000);
}
log('spawned', { kit: KIT, pos: me.pos });
console.log('spawned at', me.pos);
await delay(1500);

const heading = (q) => {           // the body's forward row, server frame: (sin h, cos h)
  const [x, y, z, w] = q;
  return Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const t0 = performance.now();
let n = 0;
let phase = 0;
async function word(st) {
  const due = t0 + n * (1000 / 30);
  const w = due - performance.now();
  if (w > 1) await delay(w);
  log('word', { n, phase, serial: sender.serial, st });
  sender.enqueue(actionFor({ forward: !!st.forward, walk: !!st.walk, crouch: !!st.crouch, lookX: st.lookX ?? 0 }));
  n++;
}
function steer(goal, cap = 5, gain = 0.6) {
  const dx = goal[0] - me.pos[0], dz = goal[1] - me.pos[2];
  const e = wrap(Math.atan2(dx, dz) - heading(me.rot)) * 180 / Math.PI;
  const lookX = Math.max(-cap, Math.min(cap, Math.round(e / 3 * gain * 100) / 100));
  return { dist: Math.hypot(dx, dz), lookX };
}
// Run to `goal`, steering; stop when inside `within` metres (or stuck).
async function runTo(goal, within, label) {
  log('phase', { phase, label, goal });
  let best = Infinity, since = 0;
  for (let i = 0; i < 30 * 90; i++) {
    const { dist, lookX } = steer(goal);
    if (dist < within) break;
    if (dist < best - 0.3) { best = dist; since = i; }
    if (i - since > 90) { log('stuck', { label, pos: me.pos }); console.log('stuck', label, me.pos); return false; }
    await word({ forward: true, lookX });
  }
  phase++;
  return true;
}
async function hold(ticks, st, label) {
  log('phase', { phase, label, ticks, st });
  for (let i = 0; i < ticks; i++) await word(st);
  phase++;
}

for (const name of FACES) {
  const f = FACE[name];
  if (dead) break;
  let ok = true;
  for (const [x, z, within] of f.legs) if (!(ok = await runTo([x, z], within, `${name}: to ${x},${z}`))) break;
  if (!ok) break;
  // the face: steer gently at the release point (no turn in its last 3 m, so
  // the body's yaw is steady when he lets go) and release the tick he passes it
  const from = [me.pos[0], me.pos[2]];
  const dirx = f.release[0] - from[0], dirz = f.release[1] - from[1];
  const L = Math.hypot(dirx, dirz);
  log('phase', { phase, label: `${name}: ${f.walk ? 'walk' : 'run'}`, goal: f.release });
  // A pushed face (W held for `push` ticks) steers hard until the heading is
  // within 10 deg of the line, then by at most 3 deg a tick for good.
  let aligned = false;
  for (let i = 0; i < (f.push ?? 30 * 20); i++) {
    const along = ((me.pos[0] - from[0]) * dirx + (me.pos[2] - from[1]) * dirz) / L;
    if (along >= L) break;
    let lookX;
    if (f.push) {
      const s5 = steer(f.release, 5, 0.6);
      if (Math.abs(s5.lookX) < 10 / 3 * 0.6) aligned = true;
      lookX = aligned ? steer(f.release, 1, 0.3).lookX : s5.lookX;
    } else {
      lookX = L - along > 3 ? steer(f.release, 2, 0.4).lookX : 0;
    }
    await word({ forward: true, walk: !!f.walk, lookX });
  }
  phase++;
  log('released', { face: name, pos: me.pos, vel: me.vel });
  console.log('released on', name, me.pos);
  await hold(150, {}, `${name}: released`);
  await hold(90, { crouch: true }, `${name}: crouched`);
  await hold(60, {}, `${name}: stand`);
  console.log('after', name, me.pos);
}
await delay(1500);
sender.stop();
log('done', { ctrl, stats: sender.stats });
s.leave();
await delay(300);
out.end();
setTimeout(() => process.exit(0), 300);
