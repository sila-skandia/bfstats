// The page's own SoldierBody against the lab server's soldier, tick for tick.
//
// `lab/move_law_probe.mjs` drove a sidecar soldier on vanilla Wake with known
// input words at an even 30 Hz and logged the server's control state for every
// ghost block (`tests/fixtures/move_law_wake.ndjson.gz`, trimmed: the words,
// and the soldier's pos (post-resolve), rot and vel (pre-resolve), each only
// when it changed). This replays those words through `walking-body.js` on
// Wake's own heightmap and material map (a window of them,
// `tests/fixtures/move_law_wake_terrain.json.gz`) loaded the way the page
// loads a level (`heightfieldFromSamples`, a `WorldCollider`), and measures
// the page's feet against the server's at every acknowledged serial.
//
//   acked   the server's position put back at each ack (position only, what
//           the page's reconciler does), then the words to the next ack: the
//           error one ack interval of prediction makes
//   free    one run from the start serial, never corrected
//   entry   `acked` again, but through `Soldier.step(1/30)` -- the page's real
//           entry, with the world's tick (world.js -> world-soldier-tick.js)
//           -- rather than `SoldierBody` directly: the soldier's own clock,
//           stance and parachute ticks and all. A soldier clock faster than
//           the engine's would run the per-tick law more than once a tick
//           here and miss by millimetres (it did: 60 Hz, ~4 mm a tick).
//
// Both re-anchor over serials 1018..1020, where the server pushed the soldier
// 0.5 m out of a static (x steps, the velocity does not) that this harness's
// world does not carry -- the same window `lab/move_law_check.py` skips.
//
//   node harness.mjs <probe.ndjson.gz> <terrain.json.gz>
import fs from 'node:fs';
import zlib from 'node:zlib';
import { SoldierBody } from './walking-body.js';
import { Soldier } from './soldier.js';
import { ENGINE_TICK_RATE } from './soldier-locomotion.js';
import { heightfieldFromSamples } from './heightfield.js';
import { WorldCollider } from './world-collider.js';

const [logPath, terrainPath] = process.argv.slice(2);
const gunzip = (p) => zlib.gunzipSync(fs.readFileSync(p)).toString('utf8');

// --- the level: Wake's samples, through the page's own loader ---------------
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
// `scene.json`'s `heightmap.heightUnits`, which the exporter writes as
// 256 * yScale (Wake: 153.6).
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

// --- the probe ---------------------------------------------------------------
const rows = gunzip(logPath).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const words = new Map();
const phaseFirst = new Map();
for (const r of rows) {
  if (r.kind !== 'word') continue;
  words.set(r.serial, r);
  if (!phaseFirst.has(r.phase)) phaseFirst.set(r.phase, r.serial);
}
const states = new Map();
{
  let pos = null, vel = null, rot = null;
  for (const r of rows) {
    if (r.kind !== 'cs' || r.cls !== 'BFSoldierNetworkable') continue;
    if (r.pos) pos = r.pos;
    if (r.vel) vel = r.vel;
    if (r.rot) rot = r.rot;
    states.set(r.serial, { pos, vel, rot });
  }
}

// The engine's frame to the page's: z negated, and the origin a metre over the
// feet the page's body carries (PHY-10).
const feet = (p) => ({ x: p[0], y: p[1] - 1, z: -p[2] });
// Body yaw from the server's rotation: its forward row, z negated, as the page
// faces +Z at yaw 0.
function yawOf(q) {
  const [x, y, z, w] = q;
  const fx = 2 * (x * z + y * w), fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, -fz);
}
// The server's right row, page frame, for the strafe sign check.
function rightOf(q) {
  const [x, y, z, w] = q;
  return { x: 1 - 2 * (y * y + z * z), z: -(2 * (x * z - y * w)) };
}

const START = 730;
const END = phaseFirst.get(15);        // run2 carries the prone dive: not scored
const PUSH_OUT = [1018, 1020];
const RAMP_UP_WORDS = 8;

function bucket(serial, phase) {
  if (phase === 1) return serial < phaseFirst.get(1) + RAMP_UP_WORDS ? 'rampUp' : 'steady';
  if (phase === 2 || phase === 4 || phase === 6 || phase === 8 || phase === 10) return 'rampDown';
  return { 0: 'idle', 3: 'tap', 5: 'strafe', 7: 'back', 9: 'walk', 11: 'crouch', 12: 'crouchForward',
           13: 'crouchStop', 14: 'stand' }[phase] ?? null;
}

// The world's tick, which is what it hands `soldierTick` -> `Soldier.step`.
const WORLD_TICK = 1 / ENGINE_TICK_RATE;

function run(mode) {
  const ackSerials = [...states.keys()].filter((s) => s >= START).sort((a, b) => a - b);
  const first = ackSerials[0];
  const s0 = states.get(first);
  // Through the page's entry: the `Soldier` owns its body, and is never
  // `spawn`ed (its settle would put the feet on the ground probe's answer
  // rather than the server's).
  const soldier = mode === 'entry' ? new Soldier({ collider: world }) : null;
  const body = soldier ? soldier.body : new SoldierBody({ world });
  const p0 = feet(s0.pos);
  body.place(p0.x, p0.y, p0.z, yawOf(s0.rot));
  body.body.setVelocity(s0.vel[0], s0.vel[1], -s0.vel[2]);
  const errs = {};
  const verts = {};
  const speedErr = {};
  let strafeDot = null;
  let rot = s0.rot;
  for (let serial = first + 1; serial < END; serial++) {
    const w = words.get(serial);
    const st = w?.st ?? {};
    const st2 = states.get(serial);
    if (st2?.rot) rot = st2.rot;
    body.yaw = yawOf(rot);
    if (st.strafe && strafeDot === null) {
      const r = rightOf(rot);
      // the page's strafe +1 direction at this yaw: (-cos, sin)
      strafeDot = -Math.cos(body.yaw) * r.x + Math.sin(body.yaw) * r.z;
    }
    const input = {
      forward: (st.forward ? 1 : 0) - (st.back ? 1 : 0),
      strafe: st.strafe ?? 0,
      walk: Boolean(st.walk),
    };
    if (soldier) {
      soldier.step(WORLD_TICK, { ...input, crouch: Boolean(st.crouch) });
    } else {
      body.setCrouch(Boolean(st.crouch));
      body.step(1 / 30, input);
    }
    if (!st2) continue;
    const want = feet(st2.pos);
    const p = body.position;
    if (serial >= PUSH_OUT[0] && serial <= PUSH_OUT[1]) {
      body.body.setPosition(want.x, want.y, want.z);
      continue;
    }
    const key = bucket(serial, w ? w.phase : -1);
    const dh = Math.hypot(p.x - want.x, p.z - want.z) * 1000;
    const dy = (p.y - want.y) * 1000;
    if (key) {
      (errs[key] ??= []).push(dh);
      (verts[key] ??= []).push(dy);
      const v = body.velocity;
      (speedErr[key] ??= []).push(Math.hypot(v.x - st2.vel[0], v.z + st2.vel[2]) * 1000);
    }
    if (mode !== 'free') body.body.setPosition(want.x, want.y, want.z);
  }
  const stats = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { n: s.length, median: s[s.length >> 1], max: Math.max(...s.map(Math.abs)),
             absMedian: [...a].map(Math.abs).sort((x, y) => x - y)[a.length >> 1] };
  };
  const out = {};
  for (const k of Object.keys(errs)) {
    out[k] = { horizontal: stats(errs[k]), vertical: stats(verts[k]), speed: stats(speedErr[k]) };
  }
  return { phases: out, strafeDot, ticks: soldier ? soldier.clock.ticks : null,
           calls: END - first - 1 };
}

const acked = run('acked');
const free = run('free');
const entry = run('entry');
process.stdout.write(JSON.stringify({ acked: acked.phases, free: free.phases, strafeDot: acked.strafeDot,
                                       entry: entry.phases,
                                       entryTicks: { ticks: entry.ticks, calls: entry.calls },
                                       start: START, end: END }) + '\n');
