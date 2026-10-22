// The page's soldier against the lab server's on steep terrain with no input.
//
// `lab/slope_slide_probe.mjs` walked and ran a sidecar soldier over terrain
// faces on vanilla Wake's North Base shores, let go of every key on the face,
// and logged the server's control state per ack
// (`tests/fixtures/slope_slide_wake.ndjson.gz`: faces H1..H3, and the run
// I1 and walk I2 up a 46.5 deg band, trimmed, each row tagged with its run).
// This replays the same words through the page's own entry, `Soldier.step`
// once per 1/30 s world tick, on Wake's heightmap and material map (a 32 x 32
// window, `tests/fixtures/slope_slide_wake_terrain.json.gz`, 40 x 40), from a point
// where the server's soldier was walking or standing still, never corrected
// after the start. The body's yaw is the server's at each ack (between two
// acks' for a serial it never acked), as the probe steered with the look axis.
//
//   node harness.mjs <probe.ndjson.gz> <terrain.json.gz>
//
// Prints, per segment, where each soldier was at the release and at the end,
// how far each moved after the release and how fast, how far up each got
// with W held and slid back, mean speeds over named spans, and how far apart
// the two stood at the end.
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

// The fixture carries three probe runs, each row tagged with its `run`.
const rows = gunzip(logPath).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const runs = new Map();
for (const r of rows) {
  if (!runs.has(r.run)) runs.set(r.run, { words: new Map(), states: new Map(), last: {} });
  const k = runs.get(r.run);
  if (r.kind === 'word') k.words.set(r.serial, r);
  if (r.kind === 'cs' && r.cls === 'BFSoldierNetworkable') {
    for (const f of ['pos', 'vel', 'rot']) if (r[f]) k.last[f] = r[f];
    k.states.set(r.serial, { ...k.last });
  }
}
let words, states;
const use = (run) => ({ words, states } = runs.get(run));
const firstOf = (phase) => Math.min(...[...words.values()].filter((w) => w.phase === phase).map((w) => w.serial));
const lastOf = (phase) => Math.max(...[...words.values()].filter((w) => w.phase === phase).map((w) => w.serial));

// The engine's frame to the page's: z negated, the origin a metre over the feet.
const feet = (p) => ({ x: p[0], y: p[1] - 1, z: -p[2] });
const yawOf = (q) => {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (x * z + y * w), -(1 - 2 * (x * x + y * y)));
};
const yawAt = (serial) => {
  const st = states.get(serial);
  if (st) return yawOf(st.rot);
  const a = states.get(serial - 1), b = states.get(serial + 1);
  if (!a || !b) return null;
  const ya = yawOf(a.rot), yb = yawOf(b.rot);
  return ya + Math.atan2(Math.sin(yb - ya), Math.cos(yb - ya)) / 2;
};

function run(start, release, end, spans = {}) {
  const s0 = states.get(start);
  const soldier = new Soldier({ collider: world });
  const body = soldier.body;
  const p0 = feet(s0.pos);
  body.place(p0.x, p0.y, p0.z, yawOf(s0.rot));
  body.body.setVelocity(s0.vel[0], s0.vel[1], -s0.vel[2]);
  let yaw = yawOf(s0.rot);
  const track = { page: [], server: [] };
  for (let serial = start + 1; serial <= end; serial++) {
    const st = words.get(serial)?.st ?? {};
    yaw = yawAt(serial) ?? yaw;
    body.yaw = yaw;
    soldier.step(1 / ENGINE_TICK_RATE, {
      forward: (st.forward ? 1 : 0) - (st.back ? 1 : 0), strafe: st.strafe ?? 0,
      walk: Boolean(st.walk), crouch: Boolean(st.crouch),
    });
    const srv = states.get(serial);
    if (!srv) continue;
    const p = body.position, v = body.velocity, w = feet(srv.pos);
    track.page.push({ serial, x: p.x, y: p.y, z: p.z, vh: Math.hypot(v.x, v.z), vy: v.y });
    track.server.push({ serial, x: w.x, y: w.y, z: w.z, vh: Math.hypot(srv.vel[0], srv.vel[2]), vy: srv.vel[1] });
  }
  const summary = (t) => {
    const at = (s) => t.find((r) => r.serial >= s);
    const r0 = at(release), r1 = t[t.length - 1];
    const after = t.filter((r) => r.serial >= release);
    const tail = t.filter((r) => r.serial >= end - 60);   // the last two seconds
    return {
      release: [r0.x, r0.y, r0.z], end: [r1.x, r1.y, r1.z],
      moved: Math.hypot(r1.x - r0.x, r1.z - r0.z), dropped: r0.y - r1.y,
      peakSpeed: Math.max(...after.map((r) => Math.hypot(r.vh, r.vy))),
      tailDrift: Math.hypot(tail[tail.length - 1].x - tail[0].x, tail[tail.length - 1].z - tail[0].z),
    };
  };
  const page = summary(track.page), server = summary(track.server);
  // Up the slope (server +z, the page's -z): how far he got with W held, how
  // far he slid back from there before letting go, and his speed over a span.
  const climb = (t) => {
    const pushed = t.filter((r) => r.serial < release);
    let best = -Infinity, back = 0;
    for (const r of pushed) { best = Math.max(best, -r.z); back = Math.max(back, best + r.z); }
    return { furthest: best, slidBack: back };
  };
  const speed = (t, a, b) => {
    const w = t.filter((r) => r.serial >= a && r.serial <= b);
    return w.reduce((n, r) => n + r.vh, 0) / w.length;
  };
  Object.assign(page, climb(track.page));
  Object.assign(server, climb(track.server));
  for (const [name, [a, b]] of Object.entries(spans)) {
    page[name] = speed(track.page, a, b);
    server[name] = speed(track.server, a, b);
  }
  // the median speed gap while the server's soldier slides (the server's soldier faster than 1 m/s after the release)
  const sliding = track.server.map((r, i) => [r, track.page[i]])
    .filter(([r]) => r.serial >= release && Math.hypot(r.vh, r.vy) > 1);
  const gaps = sliding.map(([r, p]) => Math.abs(Math.hypot(r.vh, r.vy) - Math.hypot(p.vh, p.vy))).sort((a, b) => a - b);
  const speedGap = gaps.length ? gaps[gaps.length >> 1] : 0;
  return { start, release, end, page, server, slidingAcks: sliding.length, speedGap,
           apartAtEnd: Math.hypot(page.end[0] - server.end[0], page.end[2] - server.end[2]) };
}

// Each segment starts after the probe's last hard turn before the face (or
// from rest), so the replay is not steered on stale yaw at the face.
const out = {};
use('H');
// H1: walked down onto a 40.5 deg face and let go: the server's soldier
// slides on down the fall line over a 42.4 deg face, faster all the way,
// and stops dead on the 30.7 deg triangle below.
out.slide40 = run(2806, firstOf(13), lastOf(13));
// H2: from rest at the foot of H1, walked back up and down onto 38.3 deg
// and let go: he stops and holds.
out.hold38 = run(3105, firstOf(17), lastOf(19));
// H3: from rest, down to the shore, then run up the 42.1 deg face and let
// go on it: he stops and holds there, standing and crouched.
out.climb42 = run(3500, firstOf(22), lastOf(24));
// I1: run north up x 1265: 5.7 m/s on the flat, 5.3 on 28 deg, 5.0 on 32,
// 3.6 over the 46.5 deg band (horizontal), and over the top of it.
use('I1');
out.runUp46 = run(966, firstOf(3), lastOf(3), { flat: [966, 968], on28: [978, 992], on46: [1027, 1055] });
// I2: walk north up the same line: 2.1 m/s up to the 46.5 deg band, where he
// slows and stops in half a second 17 cm onto it, slides back to its foot
// with W still held, and stays there.
use('I2');
out.walkUp46 = run(2160, firstOf(3), lastOf(4), { flat: [2165, 2230], on28: [2260, 2300] });
process.stdout.write(JSON.stringify(out) + '\n');
