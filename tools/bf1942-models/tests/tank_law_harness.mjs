// The page's own TrackedVehicle against the lab server's Sherman, tick for tick.
//
// `lab/veh_law_probe.mjs` drove a sidecar player's Sherman on vanilla Wake
// through a scripted plan of input words at an even 30 Hz and logged the
// server's control state for every acknowledged serial
// (`tests/fixtures/tank_law_wake.ndjson.gz`, trimmed: the words, and the
// hull's whole body -- position, rotation, v, omega, the acceleration and
// friction accumulators, the sleep flag, each driven spring's push and Dprev,
// the Engine's revs, load, angles and gear, the turret bundles). This replays
// those words through `tracked-vehicle.js` on Wake's own heightmap and
// material map (a window, `tests/fixtures/tank_law_wake_terrain.json.gz`),
// starting from the server's whole state at the serial the player took the
// seat, and measures the hull against the server at every ack.
//
//   acked   the server's position, rotation and velocity put back at every
//           ack (what the page's hull reconciler does, netcode-reconcile.js
//           `createHullReconciler`), the rest the page's own: one ack
//           interval of prediction
//   free    one run from the seat, never corrected
//   frame60 `acked`, the drive handed two 1/60 s frames a tick
//
//   node harness.mjs <probe.ndjson.gz> <terrain.json.gz>
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { TrackedVehicle } from './tracked-vehicle.js';
import { heightfieldFromSamples } from './heightfield.js';
import { WorldCollider } from './world-collider.js';

const [logPath, terrainPath] = process.argv.slice(2);
const gunzip = (p) => zlib.gunzipSync(fs.readFileSync(p)).toString('utf8');

// --- the level -----------------------------------------------------------------
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
const frictionById = table(T.materialFriction, 1.0);
const resistanceById = table(T.materialResistance, T.materialResistance[0]);
const collider = new WorldCollider({ heightfield: field });
// The page's two lookups (`level-terrain.js` `surfaceFriction` / `surfaceResistance`).
const surfaceFriction = (x, z) => frictionById[field.material(x, z)] ?? 1.0;
surfaceFriction.resistance = (x, z) => resistanceById[field.material(x, z)] ?? T.materialResistance[0];

// --- the Sherman, as `viewer/maps/wake/scene.glb` carries it ---------------------
// (the chassis `ground_harness.mjs` transcribes), with the hull geometry the
// engine's box drag and inertia read: `Sherman_Hull_M1`'s header box.
const HULL_BOX = [[-1.23426, -0.60473, -2.76936], [1.2559, 0.99259, 2.99345]];
/** A driven road wheel's col0 vertex 0 under its axle (`wheelContactDepths`). */
const PROBE_DEPTH = 0.30432;

function spring(name, parent, pos, grip, strength, damping) {
  const node = new THREE.Object3D();
  node.name = name;
  node.position.set(...pos);
  node.userData = { templateKind: 'Spring', physics: { grip, strength, damping } };
  parent.add(node);
  return node;
}
function shermanNode() {
  const root = new THREE.Object3D();
  root.name = 'Sherman';
  root.userData = {
    control: 'Sherman', templateKind: 'PlayerControlObject',
    physics: { mass: 25000, drag: 2, vehicleCategory: 'VCLand' },
  };
  const lod = new THREE.Object3D(); lod.name = 'lodSherman';
  lod.userData = { templateKind: 'LodObject' };
  root.add(lod);
  const complex = new THREE.Object3D(); complex.name = 'ShermanComplex';
  complex.userData = { templateKind: 'Bundle', geometry: 'Sherman_Hull_M1' };
  lod.add(complex);
  const [lo, hi] = HULL_BOX;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
  hull.position.set((hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, -(hi[2] + lo[2]) / 2);
  complex.add(hull);
  const engine = new THREE.Object3D();
  engine.name = 'ShermanEngine';
  engine.userData = {
    templateKind: 'Engine',
    physics: {
      engineType: 'c_ETTank', torque: 4, differential: 4, numberOfGears: 5,
      gearUp: 0.95, gearDown: 0.45, gearChangeTime: 0.05,
      maxRotation: [1, 0, 1], maxSpeed: [4, 0, 10], acceleration: [4, 0, 10],
    },
    rig: {
      control: 'Sherman', automaticReset: true,
      axes: {
        yaw: { input: 'c_PIYaw', min: -1, max: 1, free: false, driver: 'position', maxSpeed: 4, direction: 1 },
        roll: { input: 'c_PIThrottle', min: -1, max: 1, free: false, driver: 'position', maxSpeed: 10, direction: 1 },
      },
    },
  };
  complex.add(engine);
  const trackL = new THREE.Object3D(); trackL.name = 'ShermanTrackL'; trackL.position.set(-0.009, -0.799, 0); engine.add(trackL);
  const trackR = new THREE.Object3D(); trackR.name = 'ShermanTrackR'; trackR.position.set(0.01, -0.799, 0); engine.add(trackR);
  for (const [track, x] of [[trackL, -0.999], [trackR, 1]]) {
    const side = x < 0 ? 'L' : 'R';
    spring(`ShermanWheel${side}3Dummy`, track, [x, 0.12, -2.05], 'c_PGFEngineDummyGrip', 0, 0);
    spring(`ShermanWheel${side}3`, track, [x, 0.12, -1.2], 'c_PGFEngineGrip', 18, 4);
    spring(`ShermanWheel${side}3DummyMiddle`, track, [x, 0.12, 0.449], 'c_PGFEngineDummyGrip', 0, 0);
    spring(`ShermanWheel${side}3Dummy2`, track, [x, 0.12, -0.3], 'c_PGFEngineDummyGrip', 0, 0);
    spring(`ShermanWheel${side}3b`, track, [x, 0.12, 1.249], 'c_PGFEngineGrip', 18, 4);
    spring(`ShermanWheel${side}3Dummy3`, track, [x, 0.12, 2.049], 'c_PGFEngineDummyGrip', 0, 0);
  }
  return root;
}

// --- the probe ---------------------------------------------------------------------
const rows = gunzip(logPath).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const words = new Map();
const phases = new Map();
const states = new Map();
for (const r of rows) {
  if (r.kind === 'word') words.set(r.serial, r);
  else if (r.kind === 'phase') phases.set(r.phase, r.name);
  else if (r.kind === 'cs') states.set(r.serial, r);
}
const serials = [...states.keys()].sort((a, b) => a - b);
const START = serials[0];                  // the seat, a whole (non-delta) state
// The plan's last word is not scored: its ack shows the hull 22.5 mm on at
// 0.35 m/s, two server ticks run against the one serial as the probe's words
// stopped (the next ack is four ticks on), which is the word stream's timing,
// not the law.
const END = Math.max(...words.keys());

// The engine's frame to the page's: z negated. A pseudo-vector (omega, a
// moment) flips the other two.
const P = (a) => new THREE.Vector3(a[0], a[1], -a[2]);
const W = (a) => new THREE.Vector3(-a[0], -a[1], a[2]);
const Q = (q) => new THREE.Quaternion(-q[0], -q[1], q[2], q[3]);
/** The Engine fields ride the wire at 0.8 of their value (`writeSignedFloat`). */
const ENGINE_WIRE = 1.25;

function seed(vehicle, st) {
  const s = vehicle.state;
  s.position.copy(P(st.pos));
  s.orientation.copy(Q(st.rot));
  s.velocity.copy(P(st.v));
  const qInv = s.orientation.clone().invert();
  s.angularVelocity.copy(W(st.w).applyQuaternion(qInv));   // body rates
  const law = vehicle.law;
  law.acc.copy(P(st.acc));
  law.racc.copy(W(st.racc));
  law.fr.copy(P(st.fr));
  law.rfr.copy(W(st.rfr));
  law.sleepiness = st.sleep ? 0 : 100;
  law.fresh = false;
  const e = vehicle.engine;
  e.revs = st.engine.revs * ENGINE_WIRE;
  e.load = st.engine.a4 * ENGINE_WIRE;
  e.rollAngle = st.engine.a10c * ENGINE_WIRE;
  e.yawAngle = st.engine.a104 * ENGINE_WIRE;
  e.gear = st.engine.gear;
  e.blend = 0;
  // Each driven spring: its relative position (track frame, 2 mm steps) less
  // its rest is the push; along the contact normal only, the quantisation's
  // off-normal part dropped. Matched to the page's wheel by its quadrant.
  const normal = { y: 0, nx: 0, ny: 1, nz: 0 };
  for (const sp of st.springs) {
    const wheel = vehicle.wheels.find((w) => w.driven
      && Math.sign(w.rest.x) === Math.sign(sp.rel[0]) && Math.sign(-w.rest.z) === Math.sign(sp.rel[2]));
    const rest = wheel.node.position;
    const d = new THREE.Vector3(sp.rel[0] - rest.x, sp.rel[1] - rest.y, -(sp.rel[2] + rest.z))
      .applyQuaternion(s.orientation);
    const at = wheel.rest.clone().applyQuaternion(s.orientation).add(s.position);
    field.engineSurface(at.x, at.z, normal);
    const n = new THREE.Vector3(normal.nx, normal.ny, normal.nz);
    wheel.push.copy(n).multiplyScalar(Math.max(0, d.dot(n)));
    wheel.dPrev.copy(n).multiplyScalar(P(sp.dprev).dot(n));
    wheel.staticGrip = st.fr && Math.hypot(...st.fr) / 30 < 0.95 * 0.8 * 1.5 * 9.82 / 30;
  }
}

function yawOf(q) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(f.x, -f.z);
}

function run(mode) {
  const vehicle = new TrackedVehicle(shermanNode(), null, {
    collider, groundHeight: (x, z, fromY) => collider.surfaceHeight(x, z, fromY), surfaceFriction,
    cockpit: false,
  });
  // What the page's boarding hands the drive (`wheelContactDepths`): the
  // probe's depth, and its material 178's friction and resistance (defined,
  // no resistance authored: the ctor's 0.01).
  for (const w of vehicle.wheels) {
    if (!w.driven) continue;
    w.contactDepth = PROBE_DEPTH;
    w.materialFriction = 1.0;
    w.materialResistance = 0.01;
  }
  seed(vehicle, states.get(START));
  const errs = {};
  let sleptAt = null, wokeAt = null, ticks = 0;
  for (let serial = START + 1; serial < END; serial++) {
    const st = words.get(serial)?.st ?? {};
    vehicle.setInput('c_PIThrottle', (st.forward ? 1 : 0) - (st.back ? 1 : 0));
    vehicle.setInput('c_PIYaw', (st.right ? 1 : 0) - (st.left ? 1 : 0));
    // The world hands the drive 1/30 s a tick; `frame60` hands it two 1/60 s
    // frames instead, which must still be one engine tick.
    if (mode === 'frame60') { vehicle.integrate(1 / 60); vehicle.integrate(1 / 60); }
    else vehicle.integrate(1 / 30);
    ticks += 1;
    const ack = states.get(serial);
    if (!ack) continue;
    // The sleep flag as the server's acks show it.
    if (vehicle.asleep && sleptAt === null) sleptAt = serial;
    if (!vehicle.asleep && sleptAt !== null && wokeAt === null) wokeAt = serial;
    if (process.env.TANK_TRACE && mode === process.env.TANK_TRACE) {
      const s = vehicle.state;
      process.stderr.write(JSON.stringify({ serial,
        dh: +(Math.hypot(s.position.x - ack.pos[0], s.position.z + ack.pos[2]) * 1000).toFixed(2),
        v: +s.velocity.length().toFixed(3), sv: +Math.hypot(...ack.v).toFixed(3), revs: +vehicle.engine.revs.toFixed(4), srevs: +(ack.engine.revs * ENGINE_WIRE).toFixed(4),
        gear: vehicle.engine.gear, sgear: ack.engine.gear, L: +vehicle.engine.prevLoad.toFixed(4), sL: +(ack.engine.a4 * ENGINE_WIRE).toFixed(4),
        steer: +vehicle.engine.steer.toFixed(3),
        wy: +(s.angularVelocity.clone().applyQuaternion(s.orientation).y).toFixed(4), swy: -ack.w[1],
        fr: vehicle.law.fr.toArray().map((x) => +x.toFixed(3)), sfr: P(ack.fr).toArray().map((x) => +x.toFixed(3)),
        rfr: vehicle.law.rfr.toArray().map((x) => +x.toFixed(3)), srfr: W(ack.rfr).toArray().map((x) => +x.toFixed(3)),
        latch: vehicle.wheels.filter((w) => w.driven).map((w) => +w.staticGrip) }) + '\n');
    }
    const s = vehicle.state;
    const want = P(ack.pos);
    const wantQ = Q(ack.rot);
    const phase = words.get(serial)?.phase ?? -1;
    const key = phases.get(phase) ?? 'seat';
    const e = (errs[key] ??= { h: [], v: [], yaw: [], revs: [], gear: 0 });
    e.h.push(Math.hypot(s.position.x - want.x, s.position.z - want.z) * 1000);
    e.v.push((s.position.y - want.y) * 1000);
    let dy = (yawOf(s.orientation) - yawOf(wantQ)) * 180 / Math.PI;
    dy -= Math.round(dy / 360) * 360;
    e.yaw.push(dy);
    e.revs.push(vehicle.engine.revs - ack.engine.revs * ENGINE_WIRE);
    if (vehicle.engine.gear !== ack.engine.gear) e.gear += 1;
    if (mode !== 'free') {
      s.position.copy(want);
      s.orientation.copy(wantQ);
      s.velocity.copy(P(ack.v));
    }
  }
  const stats = (a) => {
    const abs = a.map(Math.abs).sort((x, y) => x - y);
    return { n: abs.length, median: abs[abs.length >> 1], max: abs[abs.length - 1] };
  };
  const out = {};
  for (const [k, e] of Object.entries(errs)) {
    out[k] = { horizontal: stats(e.h), vertical: stats(e.v), yaw: stats(e.yaw), revs: stats(e.revs), gearMisses: e.gear };
  }
  return { phases: out, sleptAt, wokeAt, ticks };
}

const acked = run('acked');
const frame60 = run('frame60');
const free = run('free');
// The server's own sleep, for the countdown check.
let serverSlept = null, serverWoke = null;
for (const serial of serials) {
  const st = states.get(serial);
  if (st.sleep && serverSlept === null) serverSlept = serial;
  if (!st.sleep && serverSlept !== null && serverWoke === null) serverWoke = serial;
}
const bundles = [...states.values()].map((st) => st.bundles);
const turretMoved = bundles.some((b) => b.some((r) => r.some((v) => v !== null && Math.abs(v) > 1e-3)));
process.stdout.write(JSON.stringify({
  acked: acked.phases, frame60: frame60.phases, free: free.phases, start: START, end: END,
  sleep: { page: [acked.sleptAt, acked.wokeAt], pageFree: [free.sleptAt, free.wokeAt], server: [serverSlept, serverWoke] },
  turretMoved,
}) + '\n');
