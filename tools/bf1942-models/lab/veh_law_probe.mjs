// Vehicle ground-law probe: a sidecar soldier walks to a parked vehicle of a
// kind (KIND=tank: Sherman/M3A1, KIND=plane: SBD/Corsair), enters it with Use
// and drives a scripted plan at an even 30 Hz, logging every control state
// (raw hex + decoded hull body) and every word.
//
//   KIND=tank node lab/veh_law_probe.mjs 127.0.0.1:14568 out.ndjson
//
// The 2026-10-22 run on vanilla Wake (a Sherman, a PLAN of nine phases: the
// fixture carries them as its phase rows)
// is tests/fixtures/tank_law_wake.ndjson.gz, its control states re-decoded
// whole (every Spring's push and Dprev, every Engine field, the hull's six
// controller vectors, the turret bundles) from the raw hex this logs; the law
// it measured is lab/veh_law_check.py and ledger TANK-18..TANK-24, and the
// page is held to it by tests/test_tank_law.py.
//
// Modelled on lab/move_law_probe.mjs and lab/deploy_probe.mjs.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, BUTTON, actionFor } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}, echo = false) => {
  const line = JSON.stringify({ kind, ms: Date.now() - T0, ...rec });
  out.write(line + '\n');
  if (echo) console.log(line.slice(0, 300));
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const KIND = process.env.KIND ?? 'tank';
const WANT = process.env.WANT ? process.env.WANT.split(',') : (KIND === 'plane' ? ['SBD', 'Corsair'] : ['Sherman', 'M3A1']);
const SGS = (process.env.SG ?? '1,2,3,4,5').split(',').map(Number);
let sgi = 0;
const MAXD = Number(process.env.MAXD ?? 1e9);
const NAME = process.env.NAME ?? `vl${KIND[0]}${Date.now() % 10000}`;
const TEAM = 2;
const AVOID = (process.env.AVOID ?? '').split(',').filter(Boolean).map(Number);

const s = new Session(host, Number(portStr), { name: NAME, team: TEAM });
const me = { pos: null, rot: null, cls: null, netId: null, trail: [], at: 0 };
const veh = new Map(); // netId -> { tmpl, pos, still }
let inPlan = false;
s.on('control-state', (c) => {
  const b = c.body;
  const rec = { ok: c.ok, tick: c.tick, seq: c.seq, serial: c.controlId ?? null, cls: c.cls, netId: c.netId,
    isDelta: c.isDelta, slot: c.slot, bits: c.bits, hex: c.hex, physics: c.physics ?? null,
    tmpl: s.bodies.info(c.netId)?.tmpl ?? null };
  if (b) {
    for (const k of ['pos', 'rot', 'vel', 'vecA', 'vecB', 'vecC', 'vecD', 'vecE', 'vecF', 'flag', 'hp', 'mask']) if (b[k] !== undefined) rec[k] = b[k];
    if (b.children) rec.children = b.children.map((ch) => ({ t: ch.type, m: ch.mask, ...(ch.revs !== undefined ? { revs: ch.revs } : {}), ...(ch.gear !== undefined ? { gear: ch.gear } : {}) }));
  }
  if (inPlan || c.cls !== 'BFSoldierNetworkable') log('cs', rec);
  if (!c.ok) return;
  if (c.cls !== me.cls || c.netId !== me.netId) log('control', { cls: c.cls, netId: c.netId, tmpl: rec.tmpl, pos: b?.pos ?? null }, true);
  me.cls = c.cls; me.netId = c.netId;
  if (b?.rot) me.rot = b.rot;
  if (b && b.aimB != null) me.twist = b.aimB;
  if (b?.pos) {
    me.pos = b.pos; me.at = Date.now();
    me.trail.push({ t: me.at, p: b.pos });
    if (me.trail.length > 90) me.trail.shift();
  }
});
s.on('ghost', (g) => {
  for (const r of g.records || []) {
    if (!r.pos) continue;
    const tmpl = s.bodies.info(r.netId)?.tmpl;
    if (!tmpl || !WANT.includes(tmpl)) continue;
    let v = veh.get(r.netId);
    if (!v) { v = { tmpl, pos: r.pos, since: Date.now() }; veh.set(r.netId, v); }
    const d = Math.hypot(r.pos[0] - v.pos[0], r.pos[1] - v.pos[1], r.pos[2] - v.pos[2]);
    if (d > 0.15) { v.pos = r.pos; v.since = Date.now(); }
    v.seen = Date.now();
  }
});
let spawned = false;
s.on('event', (ev) => {
  if ((ev.type === 'SetVehicle' || ev.type === 'SetDefaultVehicle') && ev.playerId === s.me.playerId) {
    log('ev', { type: ev.type, netId: ev.netId }, true);
    if (ev.netId) spawned = true;
  }
  if (/death|kill|destroyPlayer/i.test(ev.type ?? '') && ev.playerId === s.me.playerId) log('ev', { type: ev.type }, true);
});
s.on('disconnected', (i) => { log('disconnected', i, true); });
const joined = new Promise((r) => s.once('joined', r));
await s.start();
log('joined', await joined, true);
const sender = new InputSender(s, { idle: 'zero' });
sender.on('sent', (e) => { if (!e.idle && inPlan) log('sent', { serial: e.serial, axes: e.action.axes, buttons: e.action.buttons }); });
sender.start();
const input = { forward: false, lookX: 0, buttons: 0, right: false };
let turning = false;
let pump = setInterval(() => { if (!inPlan && !turning && sender.pending.length < 2) sender.enqueue(actionFor({ forward: input.forward, right: input.right, lookX: input.lookX, buttons: input.buttons })); }, 33);
let yawOff = null;
const rotYaw = () => { const q = me.rot; if (!q) return null; const [x, y, z, w] = q; return Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y)); };

const heading = () => {
  const ry = rotYaw();
  // body yaw lags the look (twist law): steer by the trail
  return trailHeading();
};
const trailHeading = () => {
  const tr = me.trail;
  if (tr.length < 8) return null;
  const a = tr[tr.length - 8].p, b = tr[tr.length - 1].p;
  const dx = b[0] - a[0], dz = b[2] - a[2];
  if (Math.hypot(dx, dz) < 0.3) return null;
  return Math.atan2(dx, dz);
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist2d = (p) => Math.hypot(p[0] - me.pos[0], p[2] - me.pos[2]);
let lookSign = -1, twistSign = 1;
const lookYaw = () => { const ry = rotYaw(); return ry == null ? null : wrap(ry + twistSign * (me.twist ?? 0) * Math.PI / 180); };

async function spawn() {
  spawned = false; me.pos = null; me.trail = [];
  for (let tries = 0; !spawned && tries < 400; tries++) {
    await spawnSequence(s, { team: TEAM, kit: 0, spawnGroup: SGS[(sgi++) % SGS.length] });
    for (let k = 0; k < 30 && !spawned; k++) await delay(100);
  }
  if (!spawned) return false;
  for (let k = 0; k < 50 && !me.pos; k++) await delay(100);
  await delay(1200);
  log('spawned', { pos: me.pos, cls: me.cls, sg: SGS[(sgi - 1) % SGS.length] }, true);
  // calibrate the look axis: standing, lookX +2 for 6 words, read body yaw + twist
  input.forward = false; await delay(600);
  const y0 = rotYaw(), t0 = me.twist ?? 0;
  input.lookX = 2; await delay(6 * 33.4); input.lookX = 0; await delay(800);
  const y1 = rotYaw(), t1 = me.twist ?? 0;
  // expected: |delta look| = K * 12 with K ~ 0.0145 rad per unit-word
  const dBody = wrap(y1 - y0), dTw = (t1 - t0) * Math.PI / 180;
  log('calib', { y0, y1, t0, t1, dBody, dTw }, true);
  // twist sign: choose the one making body+twist change consistent with |K*12|
  const cand = [1, -1].map((sg) => ({ sg, d: dBody + sg * dTw }));
  cand.sort((p, q) => Math.abs(Math.abs(p.d) - 0.174) - Math.abs(Math.abs(q.d) - 0.174));
  // measured on the turns (tank11): +lookX raises atan2(x, z); twist reads the other way
  twistSign = -3; lookSign = 1; K = 3 * Math.PI / 180; // lab/look_law_check.py: view = body - 3 twist, view += 3 d
  log('calibrated', { twistSign, lookSign, K, cand }, true);
  return true;
}

function pickVehicle() {
  let best = null, bd = 1e9;
  const now = Date.now();
  for (const [id, v] of veh) {
    if (AVOID.includes(id) || (v.bad && now - v.bad < 30000)) continue;
    if (now - v.since < 3000) continue; // moving: someone is in it
    const d = dist2d(v.pos);
    if (d > MAXD) continue;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

// Turn-then-walk: the look axis is a per-word delta, K rad per unit-word
// (measured at the calibration: lookX 3 for 1.2 s).
let K = 0.0145;
// exact turn: enqueue the words ourselves, one per sender slot
async function turnBy(rad) {
  const total = lookSign * rad / K;
  const n = Math.max(1, Math.ceil(Math.abs(total) / 2));
  input.forward = false;
  turning = true;
  for (let i = 0; i < n; i++) {
    while (sender.pending.length >= 1) await delay(5);
    sender.enqueue(actionFor({ lookX: total / n }));
  }
  while (sender.pending.length >= 1) await delay(5);
  turning = false;
  await delay(250);
}
async function walkTo(id, tol, maxMs = 200000) {
  const start = Date.now();
  let dbg = 0, last = 1e9, stuckN = 0, detour = 0;
  const p0 = veh.get(id)?.pos;
  while (Date.now() - start < maxMs) {
    if (me.cls !== 'BFSoldierNetworkable') break;
    const v = veh.get(id);
    if (!v || !me.pos) { await delay(50); continue; }
    if (p0 && Math.hypot(v.pos[0] - p0[0], v.pos[2] - p0[2]) > 3) { input.forward = false; return 'moved'; }
    const d = dist2d(v.pos);
    if (d < tol) break;
    const want = Math.atan2(v.pos[0] - me.pos[0], v.pos[2] - me.pos[2]);
    for (let k = 0; k < 4; k++) {
      const lh = lookYaw();
      if (lh == null) break;
      const err = wrap(want - lh);
      if (Math.abs(err) < 0.08) break;
      await turnBy(err);
      await delay(150);
    }
    input.forward = true;
    await delay(Math.min(1000, Math.max(300, d / 6 * 1000)));
    const d2 = dist2d(v.pos);
    log('walk', { pos: me.pos, look: lookYaw(), ry: rotYaw(), tw: me.twist, want, d: d2 }, (++dbg % 5) === 0);
    if (d2 > last - 0.4) stuckN++; else stuckN = 0;
    last = d2;
    if (stuckN >= 2) {
      detour++;
      log('stuck', { d: d2, pos: me.pos, detour }, true);
      const side = detour % 2 ? 1 : -1;
      await turnBy(side * Math.PI / 2);
      input.forward = true; await delay(1500 + 700 * detour); input.forward = false;
      stuckN = 0; last = 1e9;
    }
  }
  input.forward = false; input.lookX = 0;
  await delay(300);
  return me.pos && veh.get(id) ? dist2d(veh.get(id).pos) : null;
}

let inVeh = false;
for (let attempt = 0; attempt < 60 && !inVeh; attempt++) {
  if (me.cls !== 'BFSoldierNetworkable' || !me.pos) { if (!(await spawn())) { log('noSpawn', {}, true); process.exit(1); } }
  await delay(1500);
  log('vehicles', { list: [...veh].map(([id, v]) => ({ id, tmpl: v.tmpl, pos: v.pos, stillMs: Date.now() - v.since, d: me.pos ? +dist2d(v.pos).toFixed(1) : null })) }, true);
  const id = pickVehicle();
  if (id == null) { log('noVehicle', {}, true); await delay(5000); continue; }
  log('target', { id, tmpl: veh.get(id).tmpl, pos: veh.get(id).pos, d: dist2d(veh.get(id).pos) }, true);
  const r = await walkTo(id, KIND === 'plane' ? 2.5 : 2.5);
  log('arrived', { id, r, pos: me.pos }, true);
  if (r === 'moved') { veh.get(id).bad = Date.now(); continue; }
  for (let k = 0; k < 6 && !inVeh; k++) {
    input.buttons = BUTTON.USE; await delay(200); input.buttons = 0; await delay(700);
    inVeh = me.cls === 'SimpleObjectNetworkable';
  }
  if (!inVeh) {
    // walk around it: try the other side
    const v = veh.get(id);
    if (v && me.pos) {
      input.forward = true; await delay(800); input.forward = false;
      for (let k = 0; k < 4 && !inVeh; k++) {
        input.buttons = BUTTON.USE; await delay(200); input.buttons = 0; await delay(700);
        inVeh = me.cls === 'SimpleObjectNetworkable';
      }
    }
    if (!inVeh && v) v.bad = Date.now();
  }
}
if (!inVeh) { log('failed', {}, true); process.exit(2); }
log('inVehicle', { cls: me.cls, netId: me.netId, tmpl: s.bodies.info(me.netId)?.tmpl, pos: me.pos }, true);
await delay(2500);

const tankPlan = [
  [60, {}, 'idle'],
  [Number(process.env.W1 ?? 150), { forward: true }, 'throttle'],
  [90, { forward: true, right: true }, 'throttle+right'],
  [90, { forward: true, left: true }, 'throttle+left'],
  [60, {}, 'release'],
  [75, { back: true }, 'brake/reverse'],
  [60, {}, 'idle2'],
  [90, { forward: true }, 'throttle2'],
  [45, { forward: true, left: true }, 'throttle+left2'],
  [75, {}, 'coast'],
];
const planePlan = [
  [60, {}, 'idle'],
  [120, { forward: true }, 'throttle'],
  [75, { forward: true, right: true }, 'throttle+right'],
  [75, { forward: true, left: true }, 'throttle+left'],
  [60, {}, 'release'],
  [75, { back: true }, 'brake'],
  [60, {}, 'idle2'],
  [60, { forward: true, left: true }, 'throttle+left2'],
  [90, {}, 'coast'],
];
const plan = process.env.PLAN ? JSON.parse(process.env.PLAN) : (KIND === 'plane' ? planePlan : tankPlan);
inPlan = true;
clearInterval(pump);
const t0 = performance.now();
let n = 0, phase = 0;
for (const [ticks, st, name] of plan) {
  log('phase', { phase, name, ticks, st }, true);
  for (let i = 0; i < ticks; i++) {
    const due = t0 + n * (1000 / 30);
    const w = due - performance.now();
    if (w > 1) await delay(w);
    log('word', { n, phase, serial: sender.serial, st });
    sender.enqueue(actionFor({ forward: !!st.forward, back: !!st.back, left: !!st.left, right: !!st.right }));
    n++;
  }
  phase++;
}
await delay(1500);
log('done', { stats: sender.stats }, true);
sender.stop();
s.leave();
await delay(300);
out.end();
setTimeout(() => process.exit(0), 300);
