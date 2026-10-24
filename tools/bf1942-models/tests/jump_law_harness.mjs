// The page's own soldier against the lab server's, tick for tick, jumping.
//
// `lab/jump_law_probe.mjs` drove a sidecar soldier on vanilla Wake (team 2,
// spawn group 1) with known words at an even 30 Hz, pressing c_PIAction on
// chosen words, and logged the server's control state for every ghost block
// (`tests/fixtures/jump_law_wake*.ndjson.gz`: the words, and the soldier's
// pos (post-resolve), rot and vel (pre-resolve), each only when it changed).
// This replays those words through the page's `Soldier.step(1/30)` (the
// world's tick, the soldier's clock, stance and body) on Wake's own terrain
// window (`move_law_wake_terrain.json.gz`, loaded as the page loads a level)
// and measures the page's feet against the server's at every acknowledged
// serial, the server's position put back at each ack (position only, what
// the page's reconciler does).
//
// The probe holds the jump as a LEVEL on some phases (the server reads it as
// one and jumps again as each jump state runs out, PHY-35); the page's own
// wire never sends that (one word per press, `ONE_SHOT_BUTTONS`), so each
// word that carries the bit is handed to the page as a fresh press.
//
//   node harness.mjs <terrain.json.gz> <probe.ndjson.gz> [...]
//   NO_WAIT=1  the page without the jump state's wait (the law before PHY-35),
//              for the before/after figures
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Soldier } from './soldier.js';
import { ENGINE_TICK_RATE } from './soldier-locomotion.js';
import { heightfieldFromSamples } from './heightfield.js';
import { WorldCollider } from './world-collider.js';

const [terrainPath, ...logPaths] = process.argv.slice(2);
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

const feet = (p) => ({ x: p[0], y: p[1] - 1, z: -p[2] });
function yawOf(q) {
  const [x, y, z, w] = q;
  const fx = 2 * (x * z + y * w), fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, -fz);
}
const WORLD_TICK = 1 / ENGINE_TICK_RATE;
const stats = (a) => {
  const abs = a.map(Math.abs).sort((x, y) => x - y);
  return { n: a.length, absMedian: abs[a.length >> 1], max: abs[abs.length - 1] };
};

function replay(logPath) {
  const rows = gunzip(logPath).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const words = new Map();
  for (const r of rows) if (r.kind === 'word') words.set(r.serial, r);
  const states = new Map();
  let pos = null, vel = null, rot = null;
  for (const r of rows) {
    if (r.kind !== 'cs' || r.cls !== 'BFSoldierNetworkable') continue;
    if (r.pos) pos = r.pos;
    if (r.vel) vel = r.vel;
    if (r.rot) rot = r.rot;
    states.set(r.serial, { pos, vel, rot });
  }
  const firstWord = Math.min(...words.keys());
  const lastWord = Math.max(...words.keys());
  const start = Math.max(...[...states.keys()].filter((s) => s < firstWord));
  const s0 = states.get(start);
  const soldier = new Soldier({ collider: world });
  const body = soldier.body;
  if (process.env.NO_WAIT === '1') {
    body.lowerBody = { begin() {}, transitions() {}, reset() {}, jumping: false };
  }
  const p0 = feet(s0.pos);
  body.place(p0.x, p0.y, p0.z, yawOf(s0.rot));
  body.body.setVelocity(s0.vel[0], s0.vel[1], -s0.vel[2]);
  body.plant();
  const vertical = {}, horizontal = {};
  const jumpTicks = [];
  let rotNow = s0.rot;
  for (let serial = start + 1; serial <= lastWord + 30; serial++) {
    const w = words.get(serial);
    const st = w?.st ?? {};
    const s = states.get(serial);
    if (s?.rot) rotNow = s.rot;
    body.yaw = yawOf(rotNow);
    if (st.jump) soldier._jumpHeld = false;     // every word with the bit is a press
    const flagsBefore = body.poseFlags;
    soldier.step(WORLD_TICK, {
      forward: (st.forward ? 1 : 0) - (st.back ? 1 : 0),
      strafe: st.strafe ?? 0,
      walk: Boolean(st.walk),
      crouch: Boolean(st.crouch),
      jump: Boolean(st.jump),
      lookX: st.lookX ?? 0,
    });
    // The jump bit set on this tick from clear: the page took a jump here.
    if ((body.poseFlags & 0x80) && !(flagsBefore & 0x80)) jumpTicks.push(serial);
    if (!s) continue;
    const want = feet(s.pos);
    const p = body.position;
    const key = w ? w.phase : 'tail';
    (vertical[key] ??= []).push((p.y - want.y) * 1000);
    (horizontal[key] ??= []).push(Math.hypot(p.x - want.x, p.z - want.z) * 1000);
    body.body.setPosition(want.x, want.y, want.z);
  }
  const phases = {};
  for (const k of Object.keys(vertical)) phases[k] = { vertical: stats(vertical[k]), horizontal: stats(horizontal[k]) };
  return { phases, jumps: jumpTicks.length, ticks: soldier.clock.ticks, calls: lastWord + 30 - start };
}

const out = {};
for (const p of logPaths) out[p.split('/').pop().replace('.ndjson.gz', '')] = replay(p);
process.stdout.write(JSON.stringify(out) + '\n');
