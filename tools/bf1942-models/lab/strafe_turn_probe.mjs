// A standing soldier running, strafing and backing while he turns, measured
// on a real server: which rows a word's move runs along (ledger PHY-38). The
// steering and log format of prone_slope_probe.mjs (cut it with
// lab/prone_slope_fixture.py, replay it with tests/strafe_turn_harness.mjs).
//
//   NAME=strafe1234 SPAWN=0,0,99999 node lab/strafe_turn_probe.mjs 127.0.0.1:14614 strafe.ndjson
//
// strafe: 1 is right, -1 left.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, actionFor } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, ms: Date.now() - T0, ...rec }) + '\n');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = process.env.NAME ?? `prone${Date.now() % 10000}`;
const TEAM = Number(process.env.TEAM ?? 2);
const KIT = Number(process.env.KIT ?? 0);
const SPOTS = (process.env.SPOTS ?? 'S19').split(',');
// TURN: look-axis units a word while turning prone; CRAWL: ticks a crawl.
const TURN = Number(process.env.TURN ?? 3);
const CRAWL = Number(process.env.CRAWL ?? 60);

// legs: [x, z, within, walk]; at: where he stops; face: the heading (deg,
// atan2(dx, dz) in the wire frame) he turns to before lying down.
const SPOT = {
  S19: { legs: [[1074.5, 839.8, 2], [1067, 842.3, 0.8, true]], face: 0 },
  C28: { legs: [[1074.5, 839.8, 2], [1070, 842.3, 1], [1063, 828, 0.8, true]], face: 90 },
  A32: { legs: [[1518, 677, 2], [1520, 686, 1], [1509, 684, 0.8, true]], face: 180 },
  G31: { legs: [[1386, 1202, 1.5], [1366, 1202, 0.8, true]], face: -90 },
  H40: { legs: [[1384, 1120, 1.5], [1366, 1120, 1, true], [1363, 1120, 0.6, true]], face: 0 },
  // East of South Base, between the conquest spawn and C: a 32 deg face
  // (downhill +z) lain across, a 36 deg one facing uphill, a 34 deg one
  // facing downhill.
  // Run in along C's shore (as S19), each from the one before.
  Q34: { legs: [[1160, 722, 2], [1150, 745, 2], [1074.5, 839.8, 2], [1090, 836, 1.5], [1094.5, 834, 1], [1094.5, 829.5, 0.8, true]], face: 0 },
  // Run up (a walk stalls on 36 deg, PHY-34's grip).
  K36: { legs: [[1160, 722, 2], [1150, 745, 2], [1074.5, 839.8, 2], [1090, 836, 1.5], [1105, 830, 1.5],
    [1118, 824, 1.2], [1117.5, 814.5, 0.8]], face: 180 },
  K32: { legs: [[1160, 722, 2], [1116, 795, 2], [1115.5, 807.5, 0.8, true]], face: 90 },
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
    mask: c.body?.mask ?? null, lower: c.body?.lower ?? null, upper: c.body?.upper ?? null });
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

const GROUPS = (process.env.SG ?? '3,2,1,4,5').split(',').map(Number);
// SPAWN='x,z,r': take only a spawn within r m of (x, z), one known to have
// an open run to the first spot (default: within 250 m of its first leg).
const [nx, nz, nr] = (process.env.SPAWN ?? '').split(',').map(Number);
const first = Number.isFinite(nr) ? [nx, nz] : SPOT[SPOTS[0]].legs[0];
const NEAR = Number.isFinite(nr) ? nr : 250;
let tries = 0;
let near = false;
for (let round = 0; round < Number(process.env.ROUNDS ?? 16); round++) {
  for (; !spawned && tries < 60; tries++) {
    await spawnSequence(s, { team: TEAM, kit: KIT, spawnGroup: GROUPS[tries % GROUPS.length] });
    for (let k = 0; k < 30 && !spawned; k++) await delay(100);
  }
  if (!spawned) { log('noSpawn'); console.log('no spawn'); process.exit(1); }
  me.pos = null;
  for (let k = 0; k < 100 && !me.pos; k++) await delay(100);
  const far = me.pos ? Math.hypot(me.pos[0] - first[0], me.pos[2] - first[1]) : Infinity;
  if (far < NEAR) { near = true; break; }
  log('farSpawn', { pos: me.pos, far });
  console.log('spawned', Math.round(far), 'm away; suicide');
  s.queue('Suicide', {});
  spawned = false;
  tries++;
  await delay(6000);
}
if (!near) { log('noNearSpawn'); console.log('no spawn near', SPOTS[0]); process.exit(1); }
log('spawned', { kit: KIT, pos: me.pos });
console.log('spawned at', me.pos);
await delay(1500);

const heading = (q) => {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const t0 = performance.now();
let n = 0;
let phase = 0;
async function word(st, press) {
  const due = t0 + n * (1000 / 30);
  const w = due - performance.now();
  if (w > 1) await delay(w);
  log('word', { n, phase, serial: sender.serial, st, ...(press ? { press } : {}) });
  sender.enqueue(actionFor({ forward: !!st.forward, back: !!st.back, walk: !!st.walk, crouch: !!st.crouch,
    lie: press === 'lie', lookX: st.lookX ?? 0, ...(st.strafe > 0 ? { right: true } : st.strafe < 0 ? { left: true } : {}) }));
  n++;
}
function steer(goal, cap = 5, gain = 0.6) {
  const dx = goal[0] - me.pos[0], dz = goal[1] - me.pos[2];
  const e = wrap(Math.atan2(dx, dz) - heading(me.rot)) * 180 / Math.PI;
  const lookX = Math.max(-cap, Math.min(cap, Math.round(e / 3 * gain * 100) / 100));
  return { dist: Math.hypot(dx, dz), lookX };
}
async function runTo(goal, within, walk, label) {
  log('phase', { phase, name: label, goal });
  let best = Infinity, since = 0;
  for (let i = 0; i < 30 * 90; i++) {
    const { dist, lookX } = steer(goal);
    if (dist < within) break;
    if (dist < best - 0.2) { best = dist; since = i; }
    if (i - since > 90) { log('stuck', { label, pos: me.pos }); console.log('stuck', label, me.pos); return false; }
    await word({ forward: true, walk: !!walk, lookX });
  }
  phase++;
  return true;
}
async function hold(ticks, st, name, press) {
  log('phase', { phase, name, ticks, st });
  for (let i = 0; i < ticks; i++) await word(st, i === 0 ? press : undefined);
  phase++;
}
// Turn standing still to a heading, a look word at a time.
async function turnTo(deg, name) {
  log('phase', { phase, name, to: deg });
  for (let i = 0; i < 200; i++) {
    const e = wrap(deg * Math.PI / 180 - heading(me.rot)) * 180 / Math.PI;
    if (Math.abs(e) < 1.5) break;
    await word({ lookX: Math.max(-3, Math.min(3, e / 3)) });
  }
  phase++;
}

await hold(30, {}, 'T: stop');
await hold(20, {}, 'T: settle');
await hold(45, { forward: true }, 'T: run');
await hold(45, { forward: true, lookX: 2 }, 'T: run-turn');
await hold(30, { forward: true, lookX: -4 }, 'T: run-turn-hard');
await hold(30, {}, 'T: stop2');
await hold(45, { strafe: 1 }, 'T: strafeR');
await hold(45, { strafe: 1, lookX: 3 }, 'T: strafeR-turn');
await hold(45, { strafe: -1, lookX: -3 }, 'T: strafeL-turn');
await hold(30, {}, 'T: stop3');
await hold(45, { forward: true, strafe: 1, lookX: 3 }, 'T: diag-turn');
await hold(45, { back: true, lookX: -2 }, 'T: back-turn');
await hold(45, { strafe: -1, lookX: 4 }, 'T: strafeL-turnR');
await hold(30, {}, 'T: stand');
console.log('done at', me.pos);
await delay(1500);
sender.stop();
log('done', { ctrl, stats: sender.stats });
s.leave();
await delay(300);
out.end();
setTimeout(() => process.exit(0), 300);
