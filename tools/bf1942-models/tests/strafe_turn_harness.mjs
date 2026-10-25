// The page's standing soldier running, strafing and backing while he turns,
// against the lab server's, tick for tick: which of his rows each word's move
// runs along (ledger PHY-38).
//
// `lab/strafe_turn_probe.mjs` ran a sidecar soldier on vanilla Wake through a
// run, a run turning, strafes turning either way, a diagonal turning and a
// back turning (`tests/fixtures/strafe_turn_wake.ndjson.gz`, cut by
// `lab/prone_slope_fixture.py`). This replays the words through the page's
// own `Soldier.step` with the server's position put back at every ack, three
// ways: both rows the facing after the word's look (`post`), both before it
// (`pre`), and the engine's split, the run row before and the strafe row
// after (`split`: the facing before, and the turn as `input.turn`).
//
//   node harness.mjs <probe.ndjson.gz> <terrain.json.gz>
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Soldier } from './soldier.js';
import { ENGINE_TICK_RATE } from './soldier-locomotion.js';
import { heightfieldFromSamples } from './heightfield.js';
import { WorldCollider } from './world-collider.js';

/** Ticks between a word and its ack reaching the page (`lag` mode). */

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
  const out = {};
  for (let serial = first + 1; serial < end; serial++) {
    const w = words.get(serial);
    const st = w?.st ?? {};
    const yPre = yawAt(states, serial - 1), yPost = yawAt(states, serial);
    let turn = 0;
    if (mode === 'post') { if (yPost !== null) body.yaw = yPost; }
    else {
      if (yPre !== null) body.yaw = yPre;
      if (mode === 'split' && yPre !== null && yPost !== null) turn = Math.atan2(Math.sin(yPost - yPre), Math.cos(yPost - yPre));
    }
    soldier.step(1 / ENGINE_TICK_RATE, {
      forward: (st.forward ? 1 : 0) - (st.back ? 1 : 0), strafe: st.strafe ?? 0, walk: Boolean(st.walk), turn,
    });
    const ack = states.get(serial);
    if (!ack || !w) continue;
    const want = feet(ack.pos);
    const p = body.position;
    const key = (names.get(w.phase) ?? 'phase' + w.phase).split(': ')[1];
    const e = (out[key] ??= { h: [], v: [] });
    e.h.push(Math.hypot(p.x - want.x, p.z - want.z) * 1000); e.v.push((p.y - want.y) * 1000);
    body.body.setPosition(want.x, want.y, want.z);
  }
  const stats = (a) => { const s = a.map(Math.abs).sort((x, y) => x - y); return [s.length, +s[s.length >> 1].toFixed(2), +s[s.length - 1].toFixed(2)]; };
  const res = {};
  for (const [k, e] of Object.entries(out)) res[k] = { h: stats(e.h), v: stats(e.v) };
  return res;
}
const result = {};
for (const [name, k] of runs) result[name] = { post: run(k, 'post'), pre: run(k, 'pre'), split: run(k, 'split') };
process.stdout.write(JSON.stringify(result) + '\n');
