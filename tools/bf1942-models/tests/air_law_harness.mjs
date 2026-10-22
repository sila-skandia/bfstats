// The page's aircraft against the lab server's, tick for tick, on its wheels.
//
// `lab/veh_law_probe.mjs` (KIND=plane) drove a sidecar player's SBD on vanilla
// Wake through scripted input words at an even 30 Hz and logged the server's
// control state for every acknowledged serial (2026-10-22/23): a straight
// takeoff roll from the pad to 36 m/s, and a taxi with rudder both ways with
// and without throttle. `tests/fixtures/air_law_sbd_wake.json.gz` carries the
// words, the server's states (position, rotation, velocity, omega, the
// acceleration and friction accumulators, the sleep flag, the Engine's revs
// and throttle angle, the wing bundles) and the SBD's own table as
// `aircraftSpec` reads it off `viewer/models/SBD.glb`; the terrain window is
// `air_law_wake_terrain.json.gz`.
//
// This replays the words through `viewer/aircraft.js` on Wake's heightmap
// and material map, from the server's whole state at the run's first ack,
// and measures the page against the server at every acknowledged serial:
//
//   acked   the server's position, rotation, velocity and omega put back at
//           every ack (the hull reconciler's job), the rest the page's own:
//           one ack interval of prediction
//   free    one run from the first ack, never corrected
//   clamp   `acked` with the law off (`groundLaw: false`): the ride-height
//           clamp, `settle` and `groundFriction` the page stood on before
//
//   node air_law_harness.mjs <fixture.json.gz> <terrain.json.gz>
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

function yawOf(q) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(f.x, -f.z);
}

function run(rows, mode) {
  const words = new Map(), phases = new Map(), states = new Map();
  for (const r of rows) {
    if (r.kind === 'word') words.set(r.serial, r);
    else if (r.kind === 'phase') phases.set(r.phase, r.name);
    else if (r.kind === 'cs') states.set(r.serial, r);
  }
  const serials = [...states.keys()].sort((a, b) => a - b);
  const start = serials[0], end = serials[serials.length - 1];
  const plane = make(mode !== 'clamp');
  seed(plane, states.get(start));
  const errs = {};
  for (let serial = start + 1; serial <= end; serial++) {
    const st = words.get(serial)?.st ?? {};
    plane.setInput('c_PIThrottle', (st.forward ? 1 : 0) - (st.back ? 1 : 0));
    plane.setInput('c_PIYaw', (st.right ? 1 : 0) - (st.left ? 1 : 0));
    if (FIX.hold) {
      // A deck plane's spawner holds it on its pad until the revs reach 0.1
      // (`hull-bodies.js` `holdSpawnedCraft`, HOLD_RELEASE_THROTTLE).
      if (!plane.released && Math.abs(plane.lawEngines[0]?.revs ?? 0) >= 0.1) plane.released = true;
      plane.held = !plane.released;
      if (plane.held) {
        const s0 = states.get(start);
        plane.state.position.copy(P(s0.pos));
        plane.state.orientation.copy(Q(s0.rot));
        plane.state.velocity.set(0, 0, 0);
        plane.state.angularVelocity.set(0, 0, 0);
      }
    }
    plane.integrate(1 / 30);
    const ack = states.get(serial);
    if (!ack) continue;
    const s = plane.state;
    const want = P(ack.pos);
    const wantQ = Q(ack.rot);
    const key = phases.get(words.get(serial)?.phase) ?? 'seat';
    const e = (errs[key] ??= { h: [], v: [], yaw: [] });
    e.h.push(Math.hypot(s.position.x - want.x, s.position.z - want.z) * 1000);
    e.v.push((s.position.y - want.y) * 1000);
    let dy = (yawOf(s.orientation) - yawOf(wantQ)) * 180 / Math.PI;
    dy -= Math.round(dy / 360) * 360;
    e.yaw.push(dy);
    if (mode !== 'free') {
      s.position.copy(want);
      s.orientation.copy(wantQ);
      s.velocity.copy(P(ack.v));
      s.angularVelocity.copy(W(ack.w));
    }
  }
  const stats = (a) => {
    const abs = a.map(Math.abs).sort((x, y) => x - y);
    return { n: abs.length, median: abs[abs.length >> 1], p90: abs[Math.floor(abs.length * 0.9)], max: abs[abs.length - 1] };
  };
  const out = {};
  for (const [k, e] of Object.entries(errs)) out[k] = { horizontal: stats(e.h), vertical: stats(e.v), yaw: stats(e.yaw) };
  return out;
}

const result = { template: FIX.template, wheels: make(true).groundLaw?.legs.length ?? 0, runs: {} };
for (const r of FIX.runs) {
  result.runs[r.name] = { acked: run(r.rows, 'acked'), free: run(r.rows, 'free'), clamp: run(r.rows, 'clamp') };
}
process.stdout.write(JSON.stringify(result) + '\n');
