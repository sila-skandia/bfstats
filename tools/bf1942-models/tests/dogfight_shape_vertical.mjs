// The up-and-over lesson's SHAPE under node (features/dogfight-school,
// reviews/vertical.md): not only who hit whom, but whether the fight flown
// is the tactic its words describe. The head below is copied from
// `dogfight_school_harness.mjs` (the Spitfire on the engine's flight law);
// the measures follow it. Prints one JSON blob.
//
// From the school harness: the Spitfire
// flown on the engine's own flight law (`viewer/aircraft.js`), the facts its
// lessons quote measured on it, the pilots' hands and moves, and every
// lesson's fights flown from nine nearby starts, as `test_dogfight_school.py`
// holds them to their words. Prints one JSON blob.
//
// The Spitfire is El Alamein's, built from its own table the way
// `flight_harness.mjs` builds it (the extracted levels are not in the
// repository; the table is the data those levels carry).

import * as THREE from 'three';
import { Aircraft } from './aircraft.js';
import { stateOf, pointNose, hardTurn, bankAndPull, bankOf, pitchOf, basis, energyHeight, len, angleBetween } from './dogfight-flight.js';
import { createPilot, geometry, situation, gunOf, PLANS, INTENTS, intentOf } from './dogfight-pilot.js';
import { runDuel, placePlane, DUEL_DT, KILL_HITS, strikesAirframe } from './dogfight-duel.js';
import { LESSONS, demoSides, KEY_WORDS, fighterRank } from './dogfight-lessons.js';
import { coach, TONE } from './dogfight-coach.js';
import { toYou } from './dogfight-live.js';
import { COURSES, flyCourse, threadCourse, crossing, RING_RADIUS } from './dogfight-rings.js';

const DT = DUEL_DT;
const r1 = v => Math.round(v * 10) / 10;
function spitfireNode() {
  const root = new THREE.Object3D();
  root.name = 'Spitfire';
  root.userData = { control: 'Spitfire', templateKind: 'PlayerControlObject',
                    physics: { mass: 2500, drag: 0.09, inertiaModifier: [0.85, 0.833, 0.84] } };
  const lod = new THREE.Object3D();
  lod.userData = { templateKind: 'LodObject' };
  const complex = new THREE.Object3D();
  complex.userData = { templateKind: 'Bundle' };
  root.add(lod); lod.add(complex);
  const cockpitLod = new THREE.Object3D();
  cockpitLod.userData = { templateKind: 'LodObject' };
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(11.298, 2.283, 9.14));
  fuselage.name = 'SpitfireCockpitExternal';
  fuselage.userData = { templateKind: 'Bundle' };
  complex.add(cockpitLod); cockpitLod.add(fuselage);
  const wing = (name, t, q, physics, axis) => {
    const n = new THREE.Object3D();
    n.name = name;
    n.position.set(...t);
    if (q) n.quaternion.set(...q);
    n.userData = { templateKind: 'Wing', control: 'Spitfire', physics,
                   ...(axis ? { rig: { control: 'Spitfire', automaticReset: true, axes: { pitch: axis } } } : {}) };
    complex.add(n);
  };
  // The regulators bind no input; their servo's limits and rates ride in
  // their `physics` (`con.py`): -2..2 at 30 deg/s, 120 deg/s^2.
  const regulator = { minRotation: [0, -2, 0], maxRotation: [0, 2, 0], maxSpeed: [0, 30, 0], acceleration: [0, 120, 0] };
  wing('SpitfireAirbreakLeft', [-1.538, 0.05, 0.882], [0.007997, -0.06052, -0.043527, 0.997185],
       { flapLift: 2, pitchOffset: 0.5, positionOffset: [1.539, -0.05, 0.883], regulateToLift: 4.91, wingToRegulatorRatio: 1,
         ...regulator });
  wing('SpitfireAirbreakRight', [1.539, 0.05, 0.882], [0.007997, 0.060511, 0.043536, 0.997186],
       { flapLift: 2, pitchOffset: 0.5, positionOffset: [-1.539, -0.05, 0.883], regulateToLift: 4.91, wingToRegulatorRatio: 1,
         ...regulator });
  wing('SpitfireRudderBackVertical', [0, 1.244, 5.452], [0, 0, -0.707101, 0.707113],
       { wingLift: 1.5, flapLift: 1.5, positionOffset: [0, -0.5, 0] },
       { input: 'c_PIYaw', min: -15, max: 15, free: false, driver: 'position', maxSpeed: 60, direction: 1 });
  wing('SpitfireBodyWingVertical', [0, 0, -0.3], [0, 0, -0.707101, 0.707113],
       { wingLift: 2, flapLift: 0, positionOffset: [0, 0, -0.6] });
  for (const [side, x, off] of [['Left', -0.889, 0.5], ['Right', 0.89, -0.5]]) {
    wing(`SpitfireRudderBack${side}`, [x, 0.89, 5.306], null,
         { wingLift: 0.5, flapLift: 0.7, positionOffset: [off, 0, 0] },
         { input: 'c_PIPitch', min: -10, max: 20, free: false, driver: 'position', maxSpeed: 60, direction: -1 });
  }
  wing('SpitfireRudderFrontLeft', [-3.814, 0.275, 0.371], [0.011254, -0.078007, -0.047231, 0.99577],
       { wingLift: 2.4, flapLift: 2.3, pitchOffset: 0.5, positionOffset: [0.5, 0, 0.41] },
       { input: 'c_PIRoll', min: -30, max: 30, free: false, driver: 'position', maxSpeed: 120, direction: -1 });
  wing('SpitfireRudderFrontRight', [3.815, 0.275, 0.371], [0.011254, 0.077998, 0.047239, 0.99577],
       { wingLift: 2.4, flapLift: 2.3, pitchOffset: 0.5, positionOffset: [-0.5, 0, 0.41] },
       { input: 'c_PIRoll', min: -30, max: 30, free: false, driver: 'position', maxSpeed: 120, direction: 1 });
  const engine = new THREE.Object3D();
  engine.name = 'SpitfireEngine';
  engine.position.set(0, 0.5, -4);
  // Its roll axis is the throttle, as `con.py` emits it: `setInputToRoll
  // c_PIThrottle` under `setAutomaticReset 1`, -3000..5000 at 1000 deg/s.
  engine.userData = { templateKind: 'Engine', control: 'Spitfire',
                      physics: { engineType: 'c_ETPlane', torque: 15, differential: 5, noPropellerEffectAtSpeed: 70,
                                 maxRotation: [0.3, 0, 5000], maxSpeed: [1000, 0, 500], acceleration: [500, 0, 1000] },
                      rig: { control: 'Spitfire', automaticReset: true,
                             axes: { roll: { input: 'c_PIThrottle', min: -3000, max: 5000, free: false, driver: 'rate',
                                             maxSpeed: 500, direction: 1, acceleration: 1000 } } } };
  complex.add(engine);
  const gear = new THREE.Object3D();
  gear.position.set(-0.645, -0.45, 3.543);
  gear.userData = { templateKind: 'LandingGear' };
  engine.add(gear);
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.215, 0.671, 0.678));
  wheel.name = 'SpitfireWheel3';
  wheel.position.set(-0.259, -1.1, -0.3);
  wheel.userData = { templateKind: 'Spring' };
  gear.add(wheel);
  return root;
}

const makePlane = () => new Aircraft(spitfireNode(), null, { cockpit: false });

/** A Spitfire in the air at `speed`, its nose `pitchDeg` up, heading -z. */
function plane({ speed = 55, altitude = 300, pitchDeg = 0 } = {}) {
  const p = makePlane();
  p.groundHeight = () => 0;
  placePlane(p, { at: [0, altitude, 0], headingDeg: 0, pitchDeg, speed });
  return p;
}
const st = p => stateOf(p.state);
const fly = (p, seconds, pilot) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const k = pilot?.(st(p), i * DT);
    if (k) {
      p.setInput('c_PIPitch', k.pitch); p.setInput('c_PIRoll', k.roll); p.setInput('c_PIYaw', k.rudder);
      p.setInput('c_PIThrottle', k.throttle ?? 1);
    }
    p.integrate(DT);
  }
  return p;
};
const along = (s, deg) => {
  const h = Math.hypot(s.velocity[0], s.velocity[2]) || 1;
  const r = deg * Math.PI / 180;
  return [s.velocity[0] / h * Math.cos(r), Math.sin(r), s.velocity[2] / h * Math.cos(r)];
};

const out = {};

// --- the up and over's shape, from one duel's tracks (side 0 the ace) ------
const D2R = Math.PI / 180;
const qOf = k => ({ x: k.q[0], y: k.q[1], z: k.q[2], w: k.q[3] });
const noseOf = k => basis(qOf(k)).F;
const pitchK = k => Math.asin(Math.max(-1, Math.min(1, noseOf(k)[1]))) / D2R;
const subv = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lenv = a => Math.hypot(a[0], a[1], a[2]);
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const acosd = x => Math.acos(Math.max(-1, Math.min(1, x))) / D2R;
/** From `me` on `him`: the range, my nose off him, my place off his tail
 *  (0 = dead astern, 180 = in front of his nose), my height over his. */
function geo(me, him) {
  const rel = subv(him.p, me.p), r = lenv(rel), los = rel.map(x => x / r);
  return { r, ata: acosd(dotv(noseOf(me), los)), aspect: acosd(dotv(noseOf(him), los)), above: me.p[1] - him.p[1] };
}
/** The heading of the path through track index `i`, degrees. */
function hdgAt(T, i) {
  const a = T[Math.max(0, i - 3)].p, b = T[Math.min(T.length - 1, i + 3)].p;
  return Math.atan2(b[0] - a[0], -(b[2] - a[2])) / D2R;
}
const wrap = a => ((a + 540) % 360) - 180;

function shapeOf(r) {
  const [A, B] = r.tracks;
  const n = Math.min(A.length, B.length);
  const idx = t => Math.min(n - 1, Math.max(0, Math.round(t / r.dt)));
  const ev = r.events.filter(e => e.side === 0);
  const tPull = ev.find(e => e.phase === 'pull')?.t ?? null;
  const tOver = ev.find(e => e.phase === 'over')?.t ?? null;
  const out = { hits: r.hits, killed: r.end?.why === 'shot down' ? r.end.winner : null, tPull, tOver };
  if (tPull === null || tOver === null) return out;
  const i0 = idx(tPull), i1 = idx(tOver);
  out.pullPitch = r1(Math.max(...A.slice(i0, i1 + 1).map(pitchK)));
  // His top: his slowest in the twelve seconds after the pull starts.
  let iTop = i0;
  for (let i = i0; i < Math.min(n, i0 + idx(12)); i++) if (A[i].v < A[iTop].v) iTop = i;
  out.tTop = r1(A[iTop].t);
  out.topSpeed = r1(A[iTop].v);
  const tops = T => Math.max(...T.slice(i0, idx(tPull + 14)).map(k => k.p[1]));
  out.gain = Math.round(tops(A) - A[i0].p[1]);
  out.topGap = Math.round(tops(A) - tops(B));
  // Over the top: the way he flew into the pull against the way he comes
  // out of it, once the nose is back below the horizon.
  let iDown = i1;
  while (iDown < n - 1 && pitchK(A[iDown]) > -10) iDown++;
  out.overTurn = Math.round(Math.abs(wrap(hdgAt(A, iDown) - hdgAt(A, Math.max(0, i0 - 5)))));
  out.overSeconds = r1(A[iDown].t - tOver);
  out.closest = r1(Math.min(...A.slice(idx(1), n).map((k, j) => lenv(subv(k.p, B[idx(1) + j].p)))));
  let zoom = 0, since = null;
  for (const e of ev) { if (e.phase === 'zoom') since ??= e.t; else if (since !== null) { zoom = Math.max(zoom, e.t - since); since = null; } }
  if (since !== null) zoom = Math.max(zoom, A[n - 1].t - since);
  out.zoomMax = r1(zoom);
  // The other pilot from his reaction (a second and a half to see the pull
  // and raise the nose) to the ace's top: how steep, and how far his nose
  // sits off the ace.
  const j0 = idx(tPull + 1.5), j1 = Math.max(idx(tPull + 2), iTop);
  const fol = B.slice(j0, j1 + 1);
  out.youClimb = r1(fol.reduce((s, k) => s + pitchK(k), 0) / fol.length);
  out.youOff = r1(fol.reduce((s, k, j) => s + geo(k, A[j0 + j]).ata, 0) / fol.length);
  let iSlow = i0;
  for (let i = i0; i < Math.min(n, i0 + idx(16)); i++) if (B[i].v < B[iSlow].v) iSlow = i;
  out.youSlowest = r1(B[iSlow].v);
  // At his top: how far, and how much faster the other is.
  const gt = geo(B[iTop], A[iTop]);
  out.atTop = { range: Math.round(gt.r), faster: r1(B[iTop].v - A[iTop].v) };
  out.shotAtTop = B.slice(Math.max(0, iTop - idx(3)), Math.min(n, iTop + idx(3))).some(k => k.o);
  // Every landed round: who, when, from where.
  out.hitsBy = [[], []];
  for (const x of r.rounds.filter(x => x.hit)) {
    const i = idx(x.hitT);
    const [me, him] = x.side === 0 ? [A[i], B[i]] : [B[i], A[i]];
    const g = geo(me, him);
    out.hitsBy[x.side].push({ t: r1(x.hitT), aspect: Math.round(g.aspect), above: Math.round(g.above), hisV: r1(him.v) });
  }
  const first = out.hitsBy[1][0];
  out.youFirst = !!first && first.t < (out.hitsBy[0][0]?.t ?? Infinity) && first.hisV < 40;
  // The ace's shooting: seconds he had a shot that lands, and how many of
  // them from 40 m or more above.
  out.aceShot = r1(A.filter(k => k.o).length * r.dt);
  out.aceShotAbove = r1(A.filter((k, i) => k.o && i < n && k.p[1] - B[i].p[1] >= 40).length * r.dt);
  return out;
}

const L = LESSONS.find(l => l.id === 'up-and-over');
out.demos = {};
for (const d of L.demos) {
  out.demos[d.id] = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
    const r = runDuel({ makePlane, seconds: L.seconds, groundAt: () => 0, sides });
    out.demos[d.id].push({ dx, dv, ...shapeOf(r) });
  }
}
out.skills = L.demos.map(d => d.skill ?? 0.7);

console.log(JSON.stringify(out));
