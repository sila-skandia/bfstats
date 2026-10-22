// The page's own ground drive against a lab server's hull, tick for tick, for
// any ground vehicle: `tank_law_harness.mjs` generalised over the chassis.
//
// The hull is built from a chassis fixture (`lab/veh_law_chassis.mjs`: the
// node tree the page's drive collects on the real level, each spring's col0
// probe depth and the inertia box), the words and the server's control
// states are a `lab/veh_law_probe.mjs` run, and the terrain is a window of the
// level's heightmap and material map.
//
//   acked   the server's position, rotation and velocity put back at every
//           ack (the page's hull reconciler), the rest the page's own
//   free    one run from the seat, never corrected
//
//   node harness.mjs <probe.ndjson.gz> <terrain.json.gz> <chassis.json.gz>
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { TrackedVehicle } from './tracked-vehicle.js';
import { GroundVehicle } from './wheeled-vehicle.js';
import { geometryInertia } from './ship-spec.js';
import { heightfieldFromSamples } from './heightfield.js';
import { WorldCollider } from './world-collider.js';
import { createHullReconciler } from './netcode-reconcile.js';

const [logPath, terrainPath, chassisPath] = process.argv.slice(2);
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
const surfaceFriction = (x, z) => frictionById[field.material(x, z)] ?? 1.0;
surfaceFriction.resistance = (x, z) => resistanceById[field.material(x, z)] ?? T.materialResistance[0];

// --- the hull, from the chassis --------------------------------------------------
const C = JSON.parse(gunzip(chassisPath));
function buildNode() {
  const root = new THREE.Object3D();
  root.name = C.template;
  root.userData = { control: C.template, templateKind: 'PlayerControlObject', physics: C.physics };
  const made = [];
  for (const n of C.nodes) {
    const node = new THREE.Object3D();
    node.name = n.name;
    node.position.fromArray(n.position);
    node.quaternion.fromArray(n.quaternion);
    node.userData = { templateKind: n.kind, ...(n.physics ? { physics: n.physics } : {}),
                      ...(n.rig ? { rig: n.rig } : {}), ...(n.geometry ? { geometry: n.geometry } : {}) };
    (n.parent < 0 ? root : made[n.parent]).add(node);
    made.push(node);
  }
  return root;
}
const Drive = C.cls === 'GroundVehicle' ? GroundVehicle : TrackedVehicle;
function build() {
  const vehicle = new Drive(buildNode(), null, {
    collider, groundHeight: (x, z, fromY) => collider.surfaceHeight(x, z, fromY), surfaceFriction,
    cockpit: false,
  });
  // What the page's boarding hands the drive (`wheelContactDepths`), and the
  // inertia box off the level's collision sidecar (`inertiaGeometryBox`).
  for (const w of vehicle.wheels) {
    const c = C.wheels.find((x) => x.name === w.node.name);
    if (c?.contactDepth) w.contactDepth = c.contactDepth;
    if (c?.materialFriction != null) w.materialFriction = c.materialFriction;
    if (c?.materialResistance != null) w.materialResistance = c.materialResistance;
  }
  vehicle.geometryBox = C.geometryBox;
  vehicle._inertia = geometryInertia(C.geometryBox);
  return vehicle;
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
const START = serials[0];
// The plan's last word is not scored (the probe's words stop under it).
const END = Math.max(...words.keys());

const P = (a) => new THREE.Vector3(a[0], a[1], -a[2]);
const W = (a) => new THREE.Vector3(-a[0], -a[1], a[2]);
const Q = (q) => new THREE.Quaternion(-q[0], -q[1], q[2], q[3]);
const ENGINE_WIRE = 1.25;

function seed(vehicle, st) {
  const s = vehicle.state;
  s.position.copy(P(st.pos));
  s.orientation.copy(Q(st.rot));
  s.velocity.copy(P(st.v));
  const qInv = s.orientation.clone().invert();
  s.angularVelocity.copy(W(st.w).applyQuaternion(qInv));
  const law = vehicle.law;
  if (law) {
    law.acc.copy(P(st.acc));
    law.racc.copy(W(st.racc));
    law.fr.copy(P(st.fr));
    law.rfr.copy(W(st.rfr));
    law.sleepiness = st.sleep ? 0 : 100;
    law.fresh = false;
  }
  const e = vehicle.engine;
  e.revs = st.engine.revs * ENGINE_WIRE;
  e.load = st.engine.a4 * ENGINE_WIRE;
  e.rollAngle = st.engine.a10c * ENGINE_WIRE;
  e.yawAngle = st.engine.a104 * ENGINE_WIRE;
  e.gear = st.engine.gear;
  e.blend = 0;
  // The networked springs are the ones with a spring (strength > 0), in the
  // tree's order. Each one's relative position (its parent's frame, 2 mm
  // steps) less its rest is its push, kept along the contact normal.
  const springs = vehicle.wheels.filter((w) => w.strength > 0);
  const normal = { y: 0, nx: 0, ny: 1, nz: 0 };
  const parentQ = new THREE.Quaternion();
  st.springs.forEach((sp, i) => {
    const wheel = springs[i];
    if (!wheel || !wheel.push) return;
    const rest = wheel.node.position;
    // The parent's rotation in the root's frame.
    const local = parentQ.identity();
    for (let p = wheel.node.parent; p && p !== vehicle.node; p = p.parent) local.premultiply(p.quaternion);
    const d = new THREE.Vector3(sp.rel[0] - rest.x, sp.rel[1] - rest.y, -sp.rel[2] - rest.z)
      .applyQuaternion(local).applyQuaternion(s.orientation);
    const at = wheel.rest.clone().applyQuaternion(s.orientation).add(s.position);
    field.engineSurface(at.x, at.z, normal);
    const n = new THREE.Vector3(normal.nx, normal.ny, normal.nz);
    wheel.push.copy(n).multiplyScalar(Math.max(0, d.dot(n)));
    wheel.dPrev.copy(n).multiplyScalar(P(sp.dprev).dot(n));
    wheel.staticGrip = st.fr && Math.hypot(...st.fr) / 30 < 0.95 * 0.8 * 1.5 * 9.82 / 30;
  });
}

function yawOf(q) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(f.x, -f.z);
}

/** Ticks between a word and its ack reaching the page (about a 130 ms round trip). */
const LAG = Number(process.env.LAG ?? 4);

function run(mode) {
  const ledger = createHullReconciler();
  const tickOf = new Map();
  const vehicle = build();
  vehicle.applyTransform();
  seed(vehicle, states.get(START));
  // `seat` mode: the drive is put on the server's pose after it settled
  // somewhere else -- the page's parked copy, 2 cm higher and 0.2 degrees
  // rolled -- as a seated page's first correction does.
  if (mode === 'seat') {
    vehicle.state.position.y += 0.02;
    vehicle.state.orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2 * Math.PI / 180));
  }
  const errs = {};
  let sleptAt = null, wokeAt = null;
  let worstUp = 1, serverWorstUp = 1;
  for (let serial = START + 1; serial < END; serial++) {
    const st = words.get(serial)?.st ?? {};
    vehicle.setInput('c_PIThrottle', (st.forward ? 1 : 0) - (st.back ? 1 : 0));
    vehicle.setInput('c_PIYaw', (st.right ? 1 : 0) - (st.left ? 1 : 0));
    vehicle.integrate(1 / 30);
    if (mode === 'lag') {
      // The page's own ledger and reconciler, the ack LAG ticks behind: what
      // `net-room.js` `correctDrivenHull` runs, round trip and all.
      const s = vehicle.state;
      ledger.record(serial, s.position.x, s.position.y, s.position.z, s.orientation.x, s.orientation.y,
        s.orientation.z, s.orientation.w, s.velocity.x, s.velocity.y, s.velocity.z);
      const ackSerial = serial - LAG;
      tickOf.set(serial, vehicle.tickId);
      const past = states.get(ackSerial);
      if (past) {
        const p = P(past.pos), q = Q(past.rot), v = P(past.v);
        const pose = { x: p.x, y: p.y, z: p.z, q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z] };
        // The rest of the acked state, as `net-sidecar.js` `hullBodyOf` hands it.
        {
          const e = past.engine;
          pose.body = { w: W(past.w).toArray(), acc: P(past.acc).toArray(), racc: W(past.racc).toArray(),
            fr: P(past.fr).toArray(), rfr: W(past.rfr).toArray(), sleep: past.sleep,
            engine: { revs: e.revs, load: e.a4, roll: e.a10c, yaw: e.a104, gear: e.gear } };
        }
        // The page's way (net-room.js correctDrivenHull): the drive takes the
        // server's state at the acked tick and runs the ticks since again;
        // `delta` is the reconciler it replaced.
        if (!vehicle.rewind?.(tickOf.get(ackSerial), pose)) {
          const plan = ledger.accept(pose, ackSerial, s);
          if (plan) vehicle.reanchor?.();
        }
      }
    }
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(vehicle.state.orientation).y;
    worstUp = Math.min(worstUp, up);
    const ack = states.get(serial);
    if (!ack) continue;
    serverWorstUp = Math.min(serverWorstUp, new THREE.Vector3(0, 1, 0).applyQuaternion(Q(ack.rot)).y);
    if (vehicle.asleep && sleptAt === null) sleptAt = serial;
    if (vehicle.asleep === false && sleptAt !== null && wokeAt === null) wokeAt = serial;
    if (process.env.VEH_TRACE === mode) {
      const s = vehicle.state;
      process.stderr.write(JSON.stringify({ serial, ph: words.get(serial)?.phase,
        dh: +(Math.hypot(s.position.x - ack.pos[0], s.position.z + ack.pos[2]) * 1000).toFixed(2),
        dy: +((s.position.y - ack.pos[1]) * 1000).toFixed(2),
        v: +s.velocity.length().toFixed(3), sv: +Math.hypot(...ack.v).toFixed(3),
        revs: +vehicle.engine.revs.toFixed(4), srevs: +(ack.engine.revs * ENGINE_WIRE).toFixed(4),
        gear: vehicle.engine.gear, sgear: ack.engine.gear,
        wy: +(s.angularVelocity.clone().applyQuaternion(s.orientation).y).toFixed(4), swy: -ack.w[1],
        fr: vehicle.law?.fr.toArray().map((x) => +x.toFixed(3)), sfr: P(ack.fr).toArray().map((x) => +x.toFixed(3)),
        acc: vehicle.law?.acc.toArray().map((x) => +x.toFixed(3)), sacc: P(ack.acc).toArray().map((x) => +x.toFixed(3)),
        push: vehicle.wheels.filter((w) => w.strength > 0).map((w) => +w.push?.length().toFixed(3)),
        spush: ack.springs.map((x) => x.rel.map((v) => +v.toFixed(3))),
        sleep: vehicle.law?.sleepiness, ssleep: ack.sleep }) + '\n');
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
    if (mode !== 'free' && mode !== 'lag') {
      s.position.copy(want);
      s.orientation.copy(wantQ);
      s.velocity.copy(P(ack.v));
      // What the page's delta reconciler does after a correction (net-room.js).
      vehicle.reanchor?.();
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
  return { phases: out, sleptAt, wokeAt, worstUp, serverWorstUp };
}

const acked = run('acked');
const free = run('free');
const seat = run('seat');
const lag = run('lag');
let serverSlept = null, serverWoke = null;
for (const serial of serials) {
  const st = states.get(serial);
  if (serial >= END) break;
  if (st.sleep && serverSlept === null) serverSlept = serial;
  if (!st.sleep && serverSlept !== null && serverWoke === null) serverWoke = serial;
}
process.stdout.write(JSON.stringify({
  template: C.template, cls: C.cls, acked: acked.phases, free: free.phases, seat: seat.phases, lag: lag.phases, start: START, end: END,
  sleep: { page: [acked.sleptAt, acked.wokeAt], pageFree: [free.sleptAt, free.wokeAt], server: [serverSlept, serverWoke] },
  worstUp: { page: free.worstUp, server: acked.serverWorstUp },
}) + '\n');
