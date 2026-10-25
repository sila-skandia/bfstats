// An aircraft's wheel contacts against the lab server's, one tick at a time,
// from the server's own state: what found the lift-off (AIRGND-9,
// `features/aircraft-flight-law`, "The lift-off").
//
// For every acknowledged serial of an air-law fixture (`tests/air_law_harness.mjs`'s
// shape) it prints:
//
//   pass       the page's collision pass (`collideWheels`) run at the server's
//              pose and velocity of that tick, from the latches the page's own
//              pass began with, and again with every latch off and on, beside
//              the server's friction, rolling-resistance and friction-moment
//              accumulators (`sfr`, `sacc`, `srfr`)
//   residAcc   where the tick before is acked too: one tick run from the
//              server's state there with each wheel's push and `Dprev` taken at
//              the server's own two poses on the engine's triangles (TERR-16)
//              and the server's accumulators, and the server's velocity less
//              the page's over the tick (m/s^2); `legsInfo` the springs' push,
//              `Dprev` and force per wheel
//
// A pass that matches the server's `fr` to the wire's precision at every
// contact, and a residual near zero with the wheels loaded, clear the ground
// law; a residual with no wheel down is the air's.
//
//   FROM=<serial> TO=<serial> [RUN=<index>] node lab/air_contact_check.mjs <fixture.json.gz> <terrain.json.gz>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..', 'viewer');
const { installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
installModuleHooks(VIEWER);
const imp = (name) => import(pathToFileURL(path.join(VIEWER, name)).href);
const THREE = await imp('vendor/three.module.js');
const { Aircraft } = await imp('aircraft.js');
const { heightfieldFromSamples } = await imp('heightfield.js');
const { WorldCollider } = await imp('world-collider.js');

const [fixturePath, terrainPath] = process.argv.slice(2);
const gunzip = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'));
const FIX = gunzip(fixturePath);
const T = gunzip(terrainPath);

// --- the level -----------------------------------------------------------------
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

// The engine's frame to the page's: z negated. A pseudo-vector (omega) flips
// the other two.
const P = (a) => new THREE.Vector3(a[0], a[1], -a[2]);
const W = (a) => new THREE.Vector3(-a[0], -a[1], a[2]);
const Q = (q) => new THREE.Quaternion(-q[0], -q[1], q[2], q[3]);
/** The Engine fields ride the wire at 0.8 of their value (`writeSignedFloat`). */
const ENGINE_WIRE = 1.25;

// A carrier's flight deck, when the run is on one: the ship's col0 faces that
// face up, placed at the server's pose of her (the page frame, baked into the
// fixture with each face's friction and resistance), as `hull-bodies.js`
// `col0DeckAt` hands them to the drive.
const deck = FIX.deck ? FIX.deck.faces.map(([ax, ay, az, bx, by, bz, cx, cy, cz, friction, resistance]) => {
  const A = new THREE.Vector3(ax, ay, az), B = new THREE.Vector3(bx, by, bz), C = new THREE.Vector3(cx, cy, cz);
  const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)).normalize();
  if (n.y < 0) n.negate();
  return { A, B, C, n, d: n.dot(A), friction, resistance };
}) : null;
function deckAt(x, z, fromY) {
  if (!deck) return null;
  let best = null;
  for (const t of deck) {
    const { A, B, C } = t;
    const det = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((B.z - C.z) * (x - C.x) + (C.x - B.x) * (z - C.z)) / det;
    const l2 = ((C.z - A.z) * (x - C.x) + (A.x - C.x) * (z - C.z)) / det;
    if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
    const y = (t.d - t.n.x * x - t.n.z * z) / t.n.y;
    if (Number.isFinite(fromY) && (y > fromY || y < fromY - 6)) continue;
    if (!best || y > best.y) best = { y, t };
  }
  return best;
}

function make(lawOn) {
  const node = new THREE.Object3D();
  node.name = FIX.template;
  node.userData = { control: FIX.template, templateKind: 'PlayerControlObject', physics: { mass: FIX.spec.mass } };
  const onDeck = (x, z, fromY) => {
    const d = deckAt(x, z, Number.isFinite(fromY) ? fromY + 0.5 : Infinity);
    return d && d.y > collider.surfaceHeight(x, z, fromY) ? d : null;
  };
  const friction = deck ? Object.assign((x, z, y) => onDeck(x, z, y)?.t.friction ?? surfaceFriction(x, z),
    { resistance: (x, z, y) => onDeck(x, z, y)?.t.resistance ?? surfaceFriction.resistance(x, z) }) : surfaceFriction;
  const plane = new Aircraft(node, null, { cockpit: false, spec: FIX.spec, surfaceFriction: friction, groundLaw: lawOn });
  plane.groundHeight = (x, z, fromY) => {
    const ground = collider.surfaceHeight(x, z, fromY);
    const d = deckAt(x, z, fromY);
    return d && d.y > ground ? d.y : ground;
  };
  if (deck) {
    plane.deckNormal = (x, z, fromY, out) => {
      const d = deckAt(x, z, fromY);
      if (!d) return false;
      out[0] = d.t.n.x; out[1] = d.t.n.y; out[2] = d.t.n.z;
      return true;
    };
  }
  plane.collider = collider;
  return plane;
}

function seed(plane, st) {
  const s = plane.state;
  s.position.copy(P(st.pos));
  s.orientation.copy(Q(st.rot));
  s.velocity.copy(P(st.v));
  s.angularVelocity.copy(W(st.w));
  const law = plane.groundLaw;
  if (law) {
    law.acc.copy(P(st.acc)); law.racc.copy(W(st.racc));
    law.fr.copy(P(st.fr)); law.rfr.copy(W(st.rfr));
    law.sleepiness = st.sleep ? 0 : 100;
    law.fresh = true;
  }
  const e = plane.lawEngines[0];
  if (e) {
    if (st.engine.revs !== undefined) e.revs = st.engine.revs * ENGINE_WIRE;
    if (st.engine.a10c !== undefined && e.maxRotationZ) e.roll.angle = st.engine.a10c * ENGINE_WIRE * e.maxRotationZ;
  }
}

// --- the probe -----------------------------------------------------------------
const GL = await imp('aircraft-ground-law.js');
const G = -FIX.spec.gravity;
const surf = { y: NaN, nx: 0, ny: 1, nz: 0 };
function pushOf(leg, pos, quat) {
  const v = new THREE.Vector3(...leg.spec.vertex).applyQuaternion(quat).add(pos);
  field.engineSurface(v.x, v.z, surf);
  const depth = v.y - surf.y;
  const n = new THREE.Vector3(surf.nx, surf.ny, surf.nz);
  const out = new THREE.Vector3();
  if (depth <= 0) out.copy(n).multiplyScalar(Math.min(1, -depth * n.lengthSq()));
  return { push: out, depth, n };
}
const rows = FIX.runs[Number(process.env.RUN ?? 0)].rows;
const words = new Map(), phases = new Map(), states = new Map();
for (const r of rows) {
  if (r.kind === 'word') words.set(r.serial, r);
  else if (r.kind === 'phase') phases.set(r.phase, r.name);
  else if (r.kind === 'cs') states.set(r.serial, r);
}
const serials = [...states.keys()].sort((a, b) => a - b);
const LO = Number(process.env.FROM ?? serials[0]), HI = Number(process.env.TO ?? serials[serials.length - 1]);
const plane = make(true);
seed(plane, states.get(serials[0]));
const law = plane.groundLaw;
const f3 = (v) => v.toArray().map((x) => +x.toFixed(3));
const setInputs = (serial) => {
  const st = words.get(serial)?.st ?? {};
  plane.setInput('c_PIThrottle', (st.forward ? 1 : 0) - (st.back ? 1 : 0));
  plane.setInput('c_PIYaw', (st.right ? 1 : 0) - (st.left ? 1 : 0));
  plane.setInput('c_PIPitch', (st.pitchUp ? 1 : 0) - (st.pitchDown ? 1 : 0));
  plane.setInput('c_PIRoll', (st.rollRight ? 1 : 0) - (st.rollLeft ? 1 : 0));
};
const putServer = (st) => {
  const s = plane.state;
  s.position.copy(P(st.pos)); s.orientation.copy(Q(st.rot));
  s.velocity.copy(P(st.v)); s.angularVelocity.copy(W(st.w));
};
for (let serial = serials[0] + 1; serial <= HI; serial++) {
  setInputs(serial);
  const prevAck = states.get(serial - 1);
  let probe = null;
  if (prevAck && serial >= LO) {
    // B: the tick from the server's state at serial-1 with the springs at the
    // server's own poses and the server's accumulators.
    const s = plane.state;
    putServer(prevAck);
    const pose1 = { pos: P(prevAck.pos), quat: Q(prevAck.rot) };
    const pp = states.get(serial - 2);
    let pose0;
    if (pp) pose0 = { pos: P(pp.pos), quat: Q(pp.rot) };
    else {
      const w = W(prevAck.w); const rate = w.length();
      const q = Q(prevAck.rot).clone();
      if (rate > 1e-9) q.premultiply(new THREE.Quaternion().setFromAxisAngle(w.clone().multiplyScalar(1 / rate), -rate / 30));
      pose0 = { pos: P(prevAck.pos).addScaledVector(P(prevAck.v), -1 / 30), quat: q.normalize() };
    }
    const legsInfo = [];
    const springAcc = new THREE.Vector3();
    for (const leg of law.legs) {
      const a = pushOf(leg, pose1.pos, pose1.quat), b = pushOf(leg, pose0.pos, pose0.quat);
      leg.push.copy(a.push); leg.dPrev.copy(b.push).multiplyScalar(-1);
      const D = a.push.clone().negate(), Dp = b.push.clone().negate();
      const k = 14.7295379 * 0.101833 * leg.spec.strength, c = leg.spec.damping * 30;
      const f = D.clone().multiplyScalar(-k).addScaledVector(D.clone().sub(Dp), -c);
      springAcc.add(f);
      legsInfo.push({ D: +a.push.length().toFixed(4), Dp: +b.push.length().toFixed(4), depth: +a.depth.toFixed(4), f: f3(f) });
    }
    law.last.valid = true; law.last.pos.copy(s.position); law.last.quat.copy(s.orientation);
    law.prev.valid = true; law.prev.pos.copy(pose0.pos); law.prev.quat.copy(pose0.quat);
    law.acc.copy(P(prevAck.acc)); law.racc.copy(W(prevAck.racc));
    law.fr.copy(P(prevAck.fr)); law.rfr.copy(W(prevAck.rfr));
    law.fresh = false;
    probe = { exactPrev: !!pp, legsInfo, springAcc: f3(springAcc) };
  }
  plane.integrate(1 / 30);
  const ack = states.get(serial);
  if (!ack) continue;
  if (serial >= LO) {
    const s = plane.state;
    const out = { serial, key: phases.get(words.get(serial)?.phase) };
    if (probe) {
      out.residAcc = f3(P(ack.v).sub(s.velocity).multiplyScalar(30));
      out.dw = f3(W(ack.w).sub(s.angularVelocity).multiplyScalar(30));
      out.dpos = f3(P(ack.pos).sub(s.position).multiplyScalar(1000));
      Object.assign(out, probe);
    }
    // A: the collision pass at the server's own pose and velocity, from the
    // latches the page's pass started with, or all off, or all on.
    const variants = {};
    const latchIn = law.legs.map((l) => l.latchIn);
    for (const latchMode of ['page', 'off', 'on']) {
      law.legs.forEach((l, i) => { l.latch = latchMode === 'page' ? latchIn[i] : latchMode === 'on'; });
      putServer(ack);
      GL.clearAccumulators(law, G);
      for (const leg of law.legs) leg.push.set(0, 0, 0);
      GL.collideWheels(plane, law, plane.state, true, G);
      variants[latchMode] = { fr: f3(law.fr), acc: f3(law.acc), rfr: f3(law.rfr), latch: law.legs.map((l) => l.latch), depth: law.legs.map((l) => +l.depth.toFixed(4)) };
    }
    law.legs.forEach((l, i) => { l.latch = variants.page.latch[i]; });
    out.sfr = f3(P(ack.fr)); out.sacc = f3(P(ack.acc)); out.srfr = f3(W(ack.rfr));
    out.pass = variants;
    out.sv = f3(P(ack.v));
    process.stdout.write(JSON.stringify(out) + '\n');
  }
  if (ack) putServer(ack);
}

