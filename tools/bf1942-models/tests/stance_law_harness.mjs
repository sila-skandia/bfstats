// The page's soldier through its stance changes against the lab server's, tick
// for tick: the prone dive, the crawl, standing up, a running and a standing
// jump.
//
// `lab/move_law_probe.mjs` (`PLAN`, `SG=4`) drove a sidecar soldier on vanilla
// El Alamein co-op, flat sand at the Allied base, 2026-10-25, and logged the
// server's control state per ghost block (`tests/fixtures/stance_law_alamein.ndjson.gz`;
// each word carries its `press`, a lie or jump button on that word). This
// replays the words through the page's own `Soldier.step` (the world's tick)
// on the level's heightmap window (`stance_law_alamein_terrain.json.gz`), the
// lie button toggling prone as the page's input does, and measures his feet
// against the server's at every acknowledged serial, by phase:
//
//   acked   the server's position put back at every ack (the page's reconciler)
//   free    one run from the first ack, never corrected
//
//   node harness.mjs <probe.ndjson.gz> <terrain.json.gz>
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Soldier } from './soldier.js';
import { ENGINE_TICK_RATE } from './soldier-locomotion.js';
import { heightfieldFromSamples } from './heightfield.js';
import { WorldCollider } from './world-collider.js';

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
const words = new Map();
const names = new Map();
for (const r of rows) {
  if (r.kind === 'word') words.set(r.serial, r);
  if (r.kind === 'phase' && r.name) names.set(r.phase, r.name);
}
const states = new Map();
{
  let pos = null, vel = null, rot = null;
  for (const r of rows) {
    if (r.kind !== 'cs' || r.cls !== 'BFSoldierNetworkable') continue;
    if (r.pos) pos = r.pos;
    if (r.vel) vel = r.vel;
    if (r.rot) rot = r.rot;
    if (pos && vel && rot) states.set(r.serial, { pos, vel, rot });
  }
}
const feet = (p) => ({ x: p[0], y: p[1] - 1, z: -p[2] });
function yawOf(q) {
  const [x, y, z, w] = q;
  const fx = 2 * (x * z + y * w), fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, -fz);
}
const WORLD_TICK = 1 / ENGINE_TICK_RATE;
const serials = [...words.keys()].sort((a, b) => a - b);
const START = serials.find((s) => states.has(s - 1) || states.has(s)) - 1;
const END = serials[serials.length - 1];

function run(mode) {
  const soldier = new Soldier({ collider: world });
  const body = soldier.body;
  let first = START;
  while (!states.has(first)) first++;
  const s0 = states.get(first);
  const p0 = feet(s0.pos);
  body.place(p0.x, p0.y, p0.z, yawOf(s0.rot));
  body.body.setVelocity(s0.vel[0], s0.vel[1], -s0.vel[2]);
  let prone = false;
  let rot = s0.rot;
  const out = {};
  const trace = [];
  for (let serial = first + 1; serial < END; serial++) {
    const w = words.get(serial);
    const st = w?.st ?? {};
    if (w?.press === 'lie') prone = !prone;
    const ack = states.get(serial);
    if (ack?.rot) rot = ack.rot;
    body.yaw = yawOf(rot);
    soldier.step(WORLD_TICK, {
      forward: (st.forward ? 1 : 0) - (st.back ? 1 : 0), strafe: st.strafe ?? 0, walk: Boolean(st.walk),
      crouch: Boolean(st.crouch), prone, jump: w?.press === 'jump',
    });
    if (!ack) continue;
    const want = feet(ack.pos);
    const p = body.position;
    const key = names.get(w?.phase) ?? `phase${w?.phase}`;
    const e = (out[key] ??= { h: [], v: [], speed: [] });
    const dh = Math.hypot(p.x - want.x, p.z - want.z) * 1000;
    const dy = (p.y - want.y) * 1000;
    const v = body.velocity;
    const ds = (Math.hypot(v.x, v.z) - Math.hypot(ack.vel[0], ack.vel[2])) * 1000;
    e.h.push(dh); e.v.push(dy); e.speed.push(ds);
    if (process.env.STANCE_TRACE === mode) {
      trace.push({ serial, key, prone, stance: soldier.stance, ss: body.stateSpeed, sl: +(body.stateSpeedLeft ?? 0).toFixed(3), pose: body.pose, dh: +dh.toFixed(1), dy: +dy.toFixed(1),
        v: +Math.hypot(v.x, v.z).toFixed(3), sv: +Math.hypot(ack.vel[0], ack.vel[2]).toFixed(3),
        vy: +v.y.toFixed(3), svy: +ack.vel[1].toFixed(3) });
    }
    if (mode === 'acked') {
      body.body.setPosition(want.x, want.y, want.z);
    }
  }
  if (trace.length) process.stderr.write(trace.map((t) => JSON.stringify(t)).join('\n') + '\n');
  const stats = (a) => {
    const s = a.map(Math.abs).sort((x, y) => x - y);
    return { n: s.length, median: s[s.length >> 1], max: s[s.length - 1] };
  };
  const res = {};
  for (const [k, e] of Object.entries(out)) res[k] = { horizontal: stats(e.h), vertical: stats(e.v), speed: stats(e.speed) };
  return res;
}

process.stdout.write(JSON.stringify({ acked: run('acked'), free: run('free'), start: START, end: END }) + '\n');
