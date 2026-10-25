// A control point's capture, measured on a real server: a sidecar soldier
// walks from his spawn into the radius of a point his side does not hold and
// stands there, and the log keeps the server's own position of him (the
// control state, every ghost block) and every control point's ghost body
// (team and the spawns-enabled byte, ControlPointNetworkable 0x08226de0), by
// the server's tick. `capture_check.py` runs the page's capture-ring estimate
// (viewer/capture-rings.js) over the same positions and prints when it
// expected each change against when the server sent it.
//
//   python3 lab/lab.py start lab/scenarios/sidecar-gazala-cq-nobots.json --wait 60
//   node lab/capture_probe.mjs 127.0.0.1:14568 capture.ndjson
//   python3 lab/capture_check.py capture.ndjson --level gazala
//
// TARGET (the level's scene frame, x,z: scene.json's own numbers) is the
// point to walk to; the default is Gazala's neutral 0PEN_BASE_crossing
// (radius 50), 290 m east of the Axis village's spawns (TEAM 1, SG 4). For
// the Allied village (team 2) run down and taken: TEAM=1 SG=7 (the crossing,
// once team 1 holds it) TARGET=1643,-604 STOP=35.
// HOLD is how long to stand once inside (s), STOP how far from the centre to
// stop (m). PLAN=leave adds a walk out of the radius half way through the
// get timer and back in, to measure the timers' reset.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, actionFor } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, ms: Date.now() - T0, ...rec }) + '\n');
const say = (kind, rec = {}) => { log(kind, rec); console.log(kind, JSON.stringify(rec)); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = process.env.NAME ?? `cap${Date.now() % 10000}`;
const TEAM = Number(process.env.TEAM ?? 1);
const KIT = Number(process.env.KIT ?? 0);
const [TX, TZ] = (process.env.TARGET ?? '1569,-312').split(',').map(Number);
// WAY: points to walk through first (scene x,z;x,z), round the statics.
const WAY = (process.env.WAY ?? '').split(';').filter(Boolean).map((p) => p.split(',').map(Number));
const HOLD = Number(process.env.HOLD ?? 40);
const STOP = Number(process.env.STOP ?? 20);
const PLAN = process.env.PLAN ?? '';
// The wire's frame is the scene's with z negated (the page's ingest).
let want = { x: TX, z: -TZ };

const s = new Session(host, Number(portStr), { name: NAME, team: TEAM });
let spawned = false;
const me = { pos: null, rot: null, tick: null };
s.on('control-state', (c) => {
  if (!c.ok || c.cls !== 'BFSoldierNetworkable') return;
  me.pos = c.body?.pos ?? me.pos; me.rot = c.body?.rot ?? me.rot; me.tick = c.tick;
  log('cs', { tick: c.tick, pos: c.body?.pos ?? null, rot: c.body?.rot ?? null });
});
const cps = new Map();
s.on('ghost', (g) => {
  for (const r of g.records ?? []) {
    if (r.cls !== 'ControlPointNetworkable' || !r.body) continue;
    const tmpl = s.bodies?.info?.(r.netId)?.tmpl ?? null;
    const prev = cps.get(r.netId);
    const now = { team: r.body.team ?? prev?.team ?? null, flag: r.body.flag ?? prev?.flag ?? null };
    cps.set(r.netId, now);
    log('cp', { tick: g.tick, id: r.netId, tmpl, mask: r.body.mask, team: r.body.team, flag: r.body.flag });
  }
});
s.on('event', (ev) => {
  if ((ev.type === 'SetVehicle' || ev.type === 'SetDefaultVehicle') && ev.playerId === s.me.playerId && ev.netId) spawned = true;
  if (ev.type === 'GameStatus') log('status', { status: ev.status });
});
s.on('disconnected', (i) => say('disconnected', i));
const joined = new Promise((r) => s.once('joined', r));
await s.start();
say('joined', await joined);
const sender = new InputSender(s, { idle: 'zero' });
sender.start();
const finish = async (code = 0) => {
  sender.stop();
  say('done', {});
  s.leave();
  await delay(400);
  out.end();
  setTimeout(() => process.exit(code), 300);
};
process.on('SIGINT', () => finish(130));

const SG = (process.env.SG ?? (TEAM === 1 ? '4' : '3')).split(',').map(Number);
for (let tries = 0; !spawned && tries < 40; tries++) {
  await spawnSequence(s, { team: TEAM, kit: KIT, spawnGroup: SG[tries % SG.length] });
  for (let k = 0; k < 30 && !spawned; k++) await delay(100);
}
if (!spawned) { say('noSpawn'); await finish(1); }
for (let k = 0; k < 50 && !me.pos; k++) await delay(100);
say('spawned', { pos: me.pos, target: [want.x, want.z] });
await delay(1500);

// Heading in the wire frame, atan2(dx, dz), as move_law_probe.mjs turns by.
const headingOf = () => {
  const [x, y, z, w] = me.rot;
  return Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y)) * 180 / Math.PI;
};
const distance = () => Math.hypot(want.x - me.pos[0], want.z - me.pos[2]);
// One word a world tick: turn toward the point (3 degrees a unit word) and
// run while farther than `until`.
// A soldier standing still turns only his torso (the twist register), so the
// run starts at once and the body comes round as he moves. Stuck on a static
// for a second, he runs off at an angle for two seconds (75 degrees, then
// 120, alternating sides) and tries the straight line again.
const DETOURS = [75, -75, 120, -120, 160, -160];
async function walkTo(until, away = false) {
  const t0 = performance.now();
  let mark = me.pos.slice(), detour = 0, offset = 0, tries = 0;
  for (let n = 0; ; n++) {
    const due = t0 + n * (1000 / 30);
    const w = due - performance.now();
    if (w > 1) await delay(w);
    const d = distance();
    const done = away ? d > until : d < until;
    if (done || n > 30 * 240) { sender.enqueue(actionFor({})); return d; }
    let goal = Math.atan2(want.x - me.pos[0], want.z - me.pos[2]) * 180 / Math.PI;
    if (away) goal += 180;
    if (n % 30 === 29) {
      const moved = Math.hypot(me.pos[0] - mark[0], me.pos[2] - mark[2]);
      if (!detour && moved < 1.5) {
        offset = DETOURS[tries++ % DETOURS.length];
        detour = 60;
        log('detour', { tick: me.tick, offset });
      } else if (!detour && moved > 3) tries = 0;
      mark = me.pos.slice();
    }
    if (detour > 0) { detour--; goal += offset; }
    let delta = goal - headingOf();
    delta -= Math.round(delta / 360) * 360;
    const lookX = Math.max(-1, Math.min(1, delta / 3));
    sender.enqueue(actionFor({ forward: true, lookX }));
  }
}

for (const [wx, wz] of WAY) {
  const goal = want;
  want = { x: wx, z: -wz };
  say('waypoint', { at: [wx, wz], distance: await walkTo(3) });
  want = goal;
}
say('walk', { from: me.pos, distance: distance() });
const at = await walkTo(STOP);
if (at > STOP) { say('gaveUp', { tick: me.tick, distance: at }); await finish(2); }
say('inside', { tick: me.tick, distance: at });
if (PLAN === 'leave') {
  await delay(15000);
  say('leaving', { tick: me.tick });
  await walkTo(Number(process.env.OUT ?? 25), true);
  say('outside', { tick: me.tick, distance: distance() });
  await delay(6000);
  say('return', { tick: me.tick });
  await walkTo(STOP);
  say('inside', { tick: me.tick, distance: distance() });
}
await delay(HOLD * 1000);
await finish(0);
