// The page's soldier lying, crawling and turning prone on terrain slopes
// against the lab server's, tick for tick.
//
// `lab/prone_slope_probe.mjs` ran a sidecar soldier on vanilla Wake to spots
// on faces of several grades, stopped, lay down, lay still, crawled, turned
// prone with the look axis, crawled again, crawled turning, crawled back and
// sideways, stood up, crouched and stood; the server's control state was
// logged per ack (`tests/fixtures/prone_slope_wake.ndjson.gz`, `lab/prone_slope_fixture.py`,
// one segment per spot, each row tagged with its `run`). This replays each
// segment's words through the page's own `Soldier.step` on the level's
// heightmap window and measures, at every acknowledged serial and by phase,
// his feet against the server's and his up row against the server's (the
// rotation quaternion's second row):
//
//   acked   the server's position put back at every ack
//   lag     the page's own reconciler (`netcode-reconcile.js`, as `net-room.js`
//           builds it against a sidecar: the whole acked error, y only past
//           its tolerance) with each ack reaching the page LAG ticks late
//   free    one run from the segment's first ack, never corrected
//
//   node harness.mjs <probe.ndjson.gz> <terrain.json.gz>
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Soldier } from './soldier.js';
import { ENGINE_TICK_RATE } from './soldier-locomotion.js';
import { heightfieldFromSamples } from './heightfield.js';
import { WorldCollider } from './world-collider.js';
import { createReconciler, CORRECTION_Y_TOLERANCE } from './netcode-reconcile.js';

/** Ticks between a word and its ack reaching the page (`lag` mode). */
const LAG = Number(process.env.LAG ?? 4);

const [logPath, terrainPath] = process.argv.slice(2);
const gunzip = (p) => zlib.gunzipSync(fs.readFileSync(p)).toString('utf8');

const T = JSON.parse(gunzip(terrainPath));
const DIM = T.dim;
const rgba = new Uint8Array(DIM * DIM * 4);
const ids = new Uint8Array(DIM * DIM);
for (let j = 0; j < T.n; j++) {
  for (let i = 0; i < T.n; i++) {
    const at = (T.j0 + j) * DIM + (T.i0 + i);
    const raw = T.heights[j * T.n + i];
    rgba[at * 4] = raw >> 8;
    rgba[at * 4 + 1] = raw & 0xff;
    ids[at] = T.materials[j * T.n + i];
  }
}
const field = heightfieldFromSamples(rgba, { dim: DIM, spacing: T.spacing, heightUnits: 256 * T.yScale });
field.setMaterials(ids, DIM, T.spacing);
const table = (entries, fallback) => {
  const top = Math.max(...Object.keys(entries).map(Number));
  const out = new Float64Array(top + 1).fill(fallback);
  for (const [k, value] of Object.entries(entries)) out[Number(k)] = value;
  return out;
};
const world = new WorldCollider({ heightfield: field });
world.materialFrictionById = table(T.materialFriction, 1.0);
world.materialResistanceById = table(T.materialResistance, T.materialResistance[0]);

const rows = gunzip(logPath).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const runs = new Map();
for (const r of rows) {
  if (!runs.has(r.run)) runs.set(r.run, { words: new Map(), states: new Map(), names: new Map() });
  const k = runs.get(r.run);
  if (r.kind === 'word') k.words.set(r.serial, r);
  if (r.kind === 'phase') k.names.set(r.phase, r.name);
  if (r.kind === 'cs') k.states.set(r.serial, r);
}

// The engine's frame to the page's: z negated, the origin a metre over the feet.
const feet = (p) => ({ x: p[0], y: p[1] - 1, z: -p[2] });
const yawOf = (q) => {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (x * z + y * w), -(1 - 2 * (x * x + y * y)));
};
// The quaternion's up row, in the page's frame.
const upOf = (q) => {
  const [x, y, z, w] = q;
  return { x: 2 * (x * y - w * z), y: 1 - 2 * (x * x + z * z), z: -2 * (y * z + w * x) };
};
const yawAt = (states, serial) => {
  const st = states.get(serial);
  if (st) return yawOf(st.rot);
  const a = states.get(serial - 1), b = states.get(serial + 1);
  if (!a || !b) return null;
  const ya = yawOf(a.rot), yb = yawOf(b.rot);
  return ya + Math.atan2(Math.sin(yb - ya), Math.cos(yb - ya)) / 2;
};

// The angle the server's soldier turned about his own up row from the ack
// before `serial` to `serial`'s, as the page's yaw turns (z flipped), or null
// when either ack is missing.
const rowsOf = (q) => {
  const [x, y, z, w] = q;
  return { u: upOf(q), f: { x: 2 * (x * z + y * w), y: 2 * (y * z - w * x), z: -(1 - 2 * (x * x + y * y)) } };
};
function turnAbout(states, serial) {
  const a = states.get(serial - 1), b = states.get(serial);
  if (!a || !b) return null;
  const A = rowsOf(a.rot), B = rowsOf(b.rot);
  const u = B.u;
  const d = A.f.x * u.x + A.f.y * u.y + A.f.z * u.z;
  const p = { x: A.f.x - d * u.x, y: A.f.y - d * u.y, z: A.f.z - d * u.z };
  const c = p.x * B.f.x + p.y * B.f.y + p.z * B.f.z;
  const cr = { x: p.y * B.f.z - p.z * B.f.y, y: p.z * B.f.x - p.x * B.f.z, z: p.x * B.f.y - p.y * B.f.x };
  return Math.atan2(cr.x * u.x + cr.y * u.y + cr.z * u.z, c);
}

function run({ words, states, names }, mode) {
  const serials = [...words.keys()].sort((a, b) => a - b);
  let first = serials[0] - 1;
  while (!states.has(first)) first++;
  const end = serials[serials.length - 1];
  const s0 = states.get(first);
  const soldier = new Soldier({ collider: world });
  const body = soldier.body;
  const p0 = feet(s0.pos);
  body.place(p0.x, p0.y, p0.z, yawOf(s0.rot));
  body.body.setVelocity(s0.vel[0], s0.vel[1], -s0.vel[2]);
  let prone = false;
  const out = {};
  const trace = [];
  const rec = createReconciler({ smoothing: 1, facing: 'acked', yTolerance: CORRECTION_Y_TOLERANCE });
  for (let serial = first + 1; serial < end; serial++) {
    const w = words.get(serial);
    const st = w?.st ?? {};
    if (soldier.proneSpent) prone = false;
    if (w?.press === 'lie') prone = !prone;
    // His facing: the server's as of the tick before (the move a word
    // carries runs along the facing from before its look, PHY-38). Lying,
    // the page's own instead: the server's turn about his up row from that
    // ack to the one before it, through `Soldier.look` (`turn`), and the
    // drift of the heading as he leans (`#updateTilt`), so the yaw the
    // crawl runs along is the page's law, never put back.
    const turned = turnAbout(states, serial - 1);
    if (soldier.stance === 'prone' && turned !== null) {
      soldier.look(turned, 0);
    } else {
      const y = yawAt(states, serial - 1);
      if (y !== null) body.yaw = y;
    }
    soldier.step(1 / ENGINE_TICK_RATE, {
      forward: (st.forward ? 1 : 0) - (st.back ? 1 : 0), strafe: st.strafe ?? 0, walk: Boolean(st.walk),
      crouch: Boolean(st.crouch), prone, jump: w?.press === 'jump',
    });
    if (mode === 'lag') {
      const p = body.position;
      rec.recordTick(serial, p.x, p.y, p.z);
      const past = states.get(serial - LAG);
      if (past) {
        const f = feet(past.pos);
        const plan = rec.accept({ x: f.x, y: f.y, z: f.z, ack: serial - LAG }, { x: p.x, y: p.y, z: p.z });
        if (plan) body.body.setPosition(plan.x, plan.y ?? p.y, plan.z);
      }
    }
    const ack = states.get(serial);
    if (!ack || !w) continue;
    const want = feet(ack.pos);
    const p = body.position;
    const key = (names.get(w.phase) ?? `phase${w.phase}`).split(': ')[1];
    const e = (out[key] ??= { h: [], v: [], speed: [], tilt: [] });
    const dh = Math.hypot(p.x - want.x, p.z - want.z) * 1000;
    const dy = (p.y - want.y) * 1000;
    const v = body.velocity;
    const ds = (Math.hypot(v.x, v.z) - Math.hypot(ack.vel[0], ack.vel[2])) * 1000;
    const su = upOf(ack.rot), u = body.up ?? { x: 0, y: 1, z: 0 };
    const tilt = Math.acos(Math.min(1, su.x * u.x + su.y * u.y + su.z * u.z)) * 180 / Math.PI;
    e.h.push(dh); e.v.push(dy); e.speed.push(ds); e.tilt.push(tilt);
    if (process.env.PRONE_TRACE === mode) {
      trace.push({ serial, key, prone, stance: soldier.stance, lower: ack.lower, dh: +dh.toFixed(1), dy: +dy.toFixed(1),
        v: +Math.hypot(v.x, v.z).toFixed(3), sv: +Math.hypot(ack.vel[0], ack.vel[2]).toFixed(3),
        vy: +v.y.toFixed(3), svy: +ack.vel[1].toFixed(3), uy: +u.y.toFixed(4), suy: +su.y.toFixed(4), tilt: +tilt.toFixed(3) });
    }
    if (mode === 'acked') body.body.setPosition(want.x, want.y, want.z);
  }
  if (trace.length) process.stderr.write(trace.map((t) => JSON.stringify(t)).join('\n') + '\n');
  const stats = (a) => {
    const s = a.map(Math.abs).sort((x, y) => x - y);
    return { n: s.length, median: s[s.length >> 1], max: s[s.length - 1] };
  };
  const res = {};
  for (const [k, e] of Object.entries(out)) {
    res[k] = { horizontal: stats(e.h), vertical: stats(e.v), speed: stats(e.speed), tilt: stats(e.tilt) };
  }
  return res;
}

const result = {};
for (const [name, k] of runs) result[name] = { acked: run(k, 'acked'), lag: run(k, 'lag'), free: run(k, 'free') };
process.stdout.write(JSON.stringify(result) + '\n');
