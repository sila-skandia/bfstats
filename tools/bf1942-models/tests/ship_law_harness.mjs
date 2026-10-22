// The page's ship against the lab server's, tick for tick, under way.
//
// `lab/veh_law_probe.mjs` (KIND=plane WANT=Daihatsu TEAM=1 SG=76) drove a
// sidecar player's Daihatsu on vanilla Wake through scripted input words at an
// even 30 Hz and logged the server's control state for every acknowledged
// serial (2026-10-23). `tests/fixtures/ship_law_daihatsu_wake.json.gz` carries
// the words, the server's states (position, rotation, velocity, omega, the
// sleep flag, the Engine's revs, throttle angle and load), the hull's table as
// `shipSpec` reads it off `viewer/models/Daihatsu.glb`, its Engine, rudder
// `Wing` and `FloatingBundle` nodes (pose, physics and rig extras) and its col0
// underside as the page installs it (`hull-bodies.js` `hullCollisionLayers`).
// The runs are the open-water stretches: the ticks where the hull scraped the
// Shokaku's stern are left out (object contacts are not the law's).
//
// This replays the words through `viewer/ship.js` from the server's whole
// state at each run's first ack and measures the page at every acknowledged
// serial:
//
//   acked    the server's position, rotation, velocity and omega put back at
//            every ack (the hull reconciler's job), the rest the page's own
//   frame60  `acked`, the page handed two 1/60 s frames a word
//   free     one run from the first ack, never corrected
//   old      `acked` with the law off (`shipLaw: false`): the 240 Hz pedal path
//            the page drove a ship with before
//
//   node ship_law_harness.mjs <fixture.json.gz>
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
const { Ship } = await imp('ship.js');

const [fixturePath] = process.argv.slice(2);
const FIX = JSON.parse(zlib.gunzipSync(fs.readFileSync(fixturePath)).toString('utf8'));

// The engine's frame to the page's: z negated. A pseudo-vector (omega) flips
// the other two.
const P = (a) => new THREE.Vector3(a[0], a[1], -a[2]);
const W = (a) => new THREE.Vector3(-a[0], -a[1], a[2]);
const Q = (q) => new THREE.Quaternion(-q[0], -q[1], q[2], q[3]);
/** The Engine fields ride the wire at 0.8 of their value (`writeSignedFloat`). */
const ENGINE_WIRE = 1.25;

function hullNode() {
  const root = new THREE.Object3D();
  root.name = FIX.template;
  root.userData = { templateKind: 'PlayerControlObject', control: FIX.template, physics: FIX.physics };
  for (const n of FIX.nodes) {
    const o = new THREE.Object3D();
    o.name = n.name;
    o.position.fromArray(n.position);
    o.quaternion.fromArray(n.quaternion);
    o.userData = { ...n.userData, name: n.name };
    root.add(o);
  }
  root.updateMatrixWorld(true);
  return root;
}

function make(lawOn) {
  const ship = new Ship(hullNode(), null, {
    cockpit: false, spec: FIX.spec, waterLevel: FIX.waterLevel, shipLaw: lawOn ? undefined : false,
  });
  ship.autoFirstPerson = false;
  ship.underside = Float32Array.from(FIX.underside);
  ship.sampleKeel = FIX.sampleKeel;
  ship.groundHeight = () => FIX.bed;
  return ship;
}

function seed(ship, st) {
  const s = ship.state;
  s.position.copy(P(st.pos));
  s.orientation.copy(Q(st.rot));
  s.velocity.copy(P(st.v));
  s.angularVelocity.copy(W(st.w));
  const e = st.engine;
  if (ship.law) {
    const law = ship.law;
    law.revs = e.revs * ENGINE_WIRE;
    law.load = (e.a4 ?? 0) * ENGINE_WIRE;
    law.engine.reg.angle = e.a10c * ENGINE_WIRE * law.engine.maxRotation;
    law.sleepiness = st.sleep ? 0 : 100;
    law.acc.copy(P(st.acc)); law.racc.copy(W(st.racc));
    law.fr.copy(P(st.fr)); law.rfr.copy(W(st.rfr));
  } else {
    ship.revs = e.revs * ENGINE_WIRE;
    ship.load = (e.a4 ?? 0) * ENGINE_WIRE;
    s.throttle = e.a10c * ENGINE_WIRE;
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
  const start = serials[0];
  // The last word is not scored: the server ran it on as the words stopped.
  const end = Math.max(...words.keys());
  const ship = make(mode !== 'old');
  seed(ship, states.get(start));
  const errs = {};
  for (let serial = start + 1; serial < end; serial++) {
    const st = words.get(serial)?.st ?? {};
    ship.setInput('c_PIThrottle', (st.forward ? 1 : 0) - (st.back ? 1 : 0));
    ship.setInput('c_PIYaw', (st.right ? 1 : 0) - (st.left ? 1 : 0));
    if (mode === 'frame60') { ship.integrate(1 / 60); ship.integrate(1 / 60); }
    else ship.integrate(1 / 30);
    const ack = states.get(serial);
    if (!ack) continue;
    const s = ship.state;
    const want = P(ack.pos);
    const wantQ = Q(ack.rot);
    const key = phases.get(words.get(serial)?.phase) ?? 'seat';
    const e = (errs[key] ??= { h: [], v: [], yaw: [], revs: [] });
    e.h.push(Math.hypot(s.position.x - want.x, s.position.z - want.z) * 1000);
    e.v.push((s.position.y - want.y) * 1000);
    let dy = (yawOf(s.orientation) - yawOf(wantQ)) * 180 / Math.PI;
    dy -= Math.round(dy / 360) * 360;
    e.yaw.push(dy);
    e.revs.push((ship.law ? ship.law.revs : ship.revs) - ack.engine.revs * ENGINE_WIRE);
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
  for (const [k, e] of Object.entries(errs)) {
    out[k] = { horizontal: stats(e.h), vertical: stats(e.v), yaw: stats(e.yaw), revs: stats(e.revs) };
  }
  return out;
}

const probe = make(true);
const result = {
  template: FIX.template,
  law: !!probe.law,
  wings: probe.law?.wings.map(w => ({ acceleration: w.axis.acceleration, automaticReset: w.axis.automaticReset, coeff: w.coeff })) ?? [],
  floats: probe.floats.length,
  runs: {},
};
for (const r of FIX.runs) {
  result.runs[r.name] = {
    acked: run(r.rows, 'acked'), frame60: run(r.rows, 'frame60'), free: run(r.rows, 'free'), old: run(r.rows, 'old'),
  };
}
process.stdout.write(JSON.stringify(result) + '\n');
