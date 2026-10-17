// A sidecar soldier plays an FH mobile gun's deploy seat on a lab server, so
// the server's own recorder (a scenario with `preload`) logs what retail does:
// where the static gun stands, when the killer charge takes the mobile gun,
// and whether the soldier seated in it dies with it (FHX-24, AI-76).
//
//   node lab/deploy_probe.mjs 127.0.0.1:14568 probe.ndjson
//
// Default: FHSW Moscow_Outskirts-1941 Conquest
// (scenarios/fhsw-moscow_outskirts-cq-deploy-rec.json). The soldier spawns at
// the German base, walks to West_Village (new_control_point3, Soviet at the
// start, 5 s to take) and holds it, which puts the German pad's
// Flak18/36mobile in play; he waits beside the pad, presses Use on the gun
// until he is in it, presses 2 for its deploy seat and holds the right button.
// The positions are the level's own (scene.json, glb axes: z negated against
// the server's, which the probe works out from where it spawns).
//
// He steers by the way he is actually moving (two control states apart), and
// the sign of the look axis is measured on the walk out, not assumed.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, BUTTON, actionFor } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const port = Number(portStr);
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}) => {
  const line = JSON.stringify({ kind, ms: Date.now() - T0, ...rec });
  out.write(line + '\n');
  console.log(line);
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const TEAM = Number(process.env.TEAM ?? 1);
const SPAWN_GROUP = Number(process.env.SPAWN_GROUP ?? 1);
const NAME = process.env.NAME ?? `dep${Date.now() % 1000}`;
// glb axes (scene.json): the point, the pad, the base spawn.
const POINT = [263.14, 35.3, -515.04];
const POINT_RADIUS = 25;
const PAD = [298.76, 35.69, -472.99];
const BASE_SPAWN_Z = -407;

const s = new Session(host, port, { name: NAME, team: TEAM, animStates: Number(process.env.ANIM_STATES ?? 0) });
const me = { pos: null, rot: null, cls: null, netId: null, hp: null, at: 0, trail: [] };
s.on('control-state', (c) => {
  if (!c.ok) return;
  if (c.cls !== me.cls || c.netId !== me.netId) log('control', { cls: c.cls, netId: c.netId, pos: c.body?.pos ?? null });
  me.cls = c.cls; me.netId = c.netId;
  if (c.body?.pos) {
    me.pos = c.body.pos; me.at = Date.now();
    me.trail.push({ t: me.at, p: c.body.pos });
    if (me.trail.length > 90) me.trail.shift();
  }
  if (c.body?.rot) me.rot = c.body.rot;
  if (Number.isFinite(c.body?.hp)) me.hp = c.body.hp;
});
let spawned = false;
s.on('event', (ev) => {
  if (['SetVehicle', 'SetDefaultVehicle', 'CreatePlayer', 'DestroyPlayer', 'Suicide', 'PlayerDeath', 'Kill'].includes(ev.type)
      || /death|kill|die/i.test(ev.type ?? ''))
    log('ev', { type: ev.type, playerId: ev.playerId, netId: ev.netId, me: ev.playerId === s.me.playerId });
  if ((ev.type === 'SetVehicle' || ev.type === 'SetDefaultVehicle') && ev.playerId === s.me.playerId && ev.netId) spawned = true;
});
s.on('denied', (i) => log('denied', i));
s.on('disconnected', (i) => log('disconnected', i));
const joined = new Promise((r) => s.once('joined', r));
await s.start();
log('joined', await joined);
const sender = new InputSender(s, { idle: 'zero' });
sender.start();
const input = { forward: false, lookX: 0, buttons: 0 };
const pump = setInterval(() => sender.enqueue(actionFor({ forward: input.forward, lookX: input.lookX, buttons: input.buttons })), 33);

for (let tries = 0; !spawned && tries < 60; tries++) {
  await spawnSequence(s, { team: TEAM, kit: 0, spawnGroup: SPAWN_GROUP });
  log('spawnRequest', { tries });
  for (let k = 0; k < 30 && !spawned; k++) await delay(100);
}
if (!spawned) { log('noSpawn'); process.exit(1); }
for (let k = 0; k < 50 && !me.pos; k++) await delay(100);
await delay(1500);
// The server's frame against the level's glb axes: the base spawns are at
// z -407 in glb, so +407 means z is negated.
const flipZ = Math.abs(me.pos[2] - BASE_SPAWN_Z) > Math.abs(me.pos[2] + BASE_SPAWN_Z);
const srv = (p) => [p[0], p[1], flipZ ? -p[2] : p[2]];
log('spawned', { pos: me.pos, flipZ });

const heading = () => {
  const tr = me.trail;
  if (tr.length < 10) return null;
  const a = tr[tr.length - 10].p, b = tr[tr.length - 1].p;
  const dx = b[0] - a[0], dz = b[2] - a[2];
  if (Math.hypot(dx, dz) < 0.3) return null;
  return Math.atan2(dx, dz);
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist2d = (p) => Math.hypot(p[0] - me.pos[0], p[2] - me.pos[2]);

// The look axis's sign: walk 1.5 s straight, then 1.5 s with look +3.
input.forward = true;
await delay(1500);
const h0 = heading();
input.lookX = 3;
await delay(1500);
input.lookX = 0;
await delay(600);
const h1 = heading();
const lookSign = h0 != null && h1 != null && wrap(h1 - h0) < 0 ? -1 : 1;
log('calibrated', { h0, h1, lookSign });

async function walkTo(goal, tol, maxMs = 180000) {
  const g = srv(goal);
  const start = Date.now();
  input.forward = true;
  while (Date.now() - start < maxMs) {
    if (!me.pos) { await delay(50); continue; }
    const d = dist2d(g);
    if (d < tol) break;
    const want = Math.atan2(g[0] - me.pos[0], g[2] - me.pos[2]);
    const h = heading();
    if (h != null) {
      const err = wrap(want - h);
      input.lookX = lookSign * Math.max(-6, Math.min(6, err * 4));
    }
    await delay(50);
  }
  input.forward = false; input.lookX = 0;
  await delay(400);
  log('arrived', { goal, at: me.pos, d: me.pos ? +dist2d(g).toFixed(2) : null, ms: Date.now() - start });
}

await walkTo(POINT, 8);
log('holding the point');
await delay(Number(process.env.HOLD_MS ?? 25000));
// Wait beside the pad, clear of its 2 m (SPAWN-14), and try the gun's doors.
const beside = [PAD[0] - 6, PAD[1], PAD[2] - 6];
await walkTo(beside, 2);
const waitUntil = Date.now() + Number(process.env.PAD_WAIT_MS ?? 400000);
let inGun = false;
while (!inGun && Date.now() < waitUntil) {
  await walkTo([PAD[0] - 2.2, PAD[1], PAD[2] - 2.2], 1.0, 20000);
  for (let k = 0; k < 4 && !inGun; k++) {
    input.buttons = BUTTON.USE; await delay(150); input.buttons = 0; await delay(600);
    inGun = !!me.cls && me.cls !== 'BFSoldierNetworkable';
  }
  if (inGun) break;
  await walkTo(beside, 2, 20000);
  await delay(8000);
}
log('inGun', { inGun, cls: me.cls, netId: me.netId, pos: me.pos });
if (inGun) {
  await delay(1500);
  input.buttons = BUTTON.MENU2; await delay(150); input.buttons = 0;
  await delay(1500);
  log('seat2', { cls: me.cls, netId: me.netId });
  log('altFire');
  input.buttons = BUTTON.ALT_FIRE; await delay(600); input.buttons = 0;
  for (let k = 0; k < 24; k++) {
    await delay(500);
    log('after', { s: (k + 1) / 2, cls: me.cls, netId: me.netId, hp: me.hp, pos: me.pos });
  }
}
clearInterval(pump);
sender.stop();
log('done');
await delay(500);
s.leave();
out.end();
setTimeout(() => process.exit(0), 300);
