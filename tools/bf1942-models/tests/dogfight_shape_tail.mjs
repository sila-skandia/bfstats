// The shapes of two dogfight-school lessons under node (features/dogfight-school,
// reviews/tail.md): "Out of his lock" and the chop demos of "On his tail",
// tick by tick from nine nearby starts, as `test_dogfight_shape_tail.py`
// holds them: who is behind whom, the overshoot the chop makes and the shot
// after it, the stalemate of the hard turn, the dive, the lag out wide.
// Prints one JSON blob. Its top is `dogfight_school_harness.mjs`'s.
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

// --- the shape of a fight, tick by tick, from the defender's seat ----------
// `d` is the defender's side (the one being hunted), `a` the attacker's.
// Velocities come from the track's own positions.
const DEGS = 180 / Math.PI;
const qOf = k => ({ x: k.q[0], y: k.q[1], z: k.q[2], w: k.q[3] });
const headingDeg = k => { const F = basis(qOf(k)).F; return Math.atan2(F[0], -F[2]) * DEGS; };
const wrap180 = a => ((a % 360) + 540) % 360 - 180;
function shapeRows(r, d, a) {
  const D = r.tracks[d], A = r.tracks[a];
  const n = Math.min(D.length, A.length);
  const rows = [];
  for (let j = 0; j < n; j++) {
    const kd = D[j], ka = A[j], prev = j > 0 ? j - 1 : 0, next = Math.min(n - 1, j + 1);
    const vel = (T, i0, i1) => i1 > i0 ? T[i1].p.map((x, i) => (x - T[i0].p[i]) / ((i1 - i0) * r.dt)) : [0, 0, 0];
    const sd = { position: kd.p, velocity: vel(D, prev, next), orientation: qOf(kd) };
    const sa = { position: ka.p, velocity: vel(A, prev, next), orientation: qOf(ka) };
    const g = geometry(sd, sa);
    const hd = headingDeg(kd) * Math.PI / 180;
    const fx = Math.sin(hd), fz = -Math.cos(hd);
    const ddx = ka.p[0] - kd.p[0], ddz = ka.p[2] - kd.p[2];
    rows.push({
      t: kd.t, rng: g.range, dAta: g.ata, aAta: g.hisAta, closure: g.closure,
      dH: Math.abs(wrap180(headingDeg(ka) - headingDeg(kd))),
      ahead: ddx * fx + ddz * fz, dv: kd.v, av: ka.v, dy: kd.p[1], ay: ka.p[1],
      dPh: kd.ph, aPh: ka.ph, dO: kd.o, aO: ka.o,
    });
  }
  return rows;
}
const secs = (rows, f, dt) => +(rows.filter(f).length * dt).toFixed(2);
// Him behind me: behind my wings, his nose within 45 of me, inside 300 m.
const onTail = k => k.dAta > 120 && k.aAta < 45 && k.rng < 300;
// Me on his tail.
const meOnHisTail = k => k.dAta < 45 && k.aAta > 120 && k.rng < 300;

/** An overshoot after tick `i0`: within `within` seconds he goes from at
 *  least 50 m behind me (along my heading) to 20 m ahead and in front of my
 *  wings. Where he crossed, how far apart our headings were then, and the
 *  closest we came. */
function overshoot(rows, i0, dt, within = 8, BEHIND = 20, AHEAD = 5) {
  const end = Math.min(rows.length, i0 + Math.round(within / dt));
  let start = -1;
  for (let j = i0; j < end; j++) {
    if (start < 0 && rows[j].ahead < -BEHIND) start = j;
    if (start >= 0 && rows[j].ahead > AHEAD && rows[j].dAta < 90) {
      let k = j;
      while (k > start && rows[k].ahead > 0) k--;
      let minR = Infinity;
      for (let m = start; m <= j; m++) minR = Math.min(minR, rows[m].rng);
      return { t: +rows[k].t.toFixed(1), i: k, dH: Math.round(rows[k].dH), minR: Math.round(minR) };
    }
  }
  return null;
}

function nearbyRuns(L, d, fn) {
  const runs = [];
  for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
    const r = runDuel({ makePlane, seconds: L.seconds, groundAt: () => 0, sides });
    runs.push({ dx, dv, ...fn(r) });
  }
  return runs;
}
const r0 = v => Math.round(v);
const hitTimes = (r, side) => r.rounds.filter(x => x.hit && x.side === side && (r.end === null || x.hitT <= r.end.t + 1e-6)).map(x => x.hitT);

// --- out of his lock: the hunter (side 0) on your tail (side 1) -------------
{
  const L = LESSONS.find(l => l.id === 'out-of-the-lock');
  // The dive and the early turn left the lesson's tabs for the Dip, the
  // Flip and the Ninja (reviews/dfn-ol.md); the story still quotes them, so
  // they are still flown here, as they were.
  const RETIRED = {
    move: { id: 'move', seat: 'olDiveOut', skill: 0.85 },
    meet: { id: 'meet', seat: 'olMeetHim', skill: 0.85, aceStart: { at: [160, 380, 460], headingDeg: -20, speed: 62 } },
  };
  const demo = id => L.demos.find(x => x.id === id) ?? RETIRED[id];
  // His lock: in my rear quarter, his nose within 30 of me, inside `reach`.
  const locked = (k, reach = 300) => k.dAta > 120 && k.aAta < 30 && k.rng < reach;
  const longest = (rows, f) => { let run = 0, best = 0; for (const k of rows) { run = f(k) ? run + 1 : 0; best = Math.max(best, run); } return best; };
  const common = (r, rows) => {
    const i0 = rows.findIndex(k => k.dPh !== 'watch' && k.dPh !== 'cruise');
    const before = i0 < 0 ? rows : rows.slice(0, i0);
    // From 3 s after the counter starts, for 20 s: where he is.
    const after = i0 < 0 ? [] : rows.slice(i0 + Math.round(3 / r.dt), i0 + Math.round(23 / r.dt));
    return {
      winner: r.end?.winner ?? null, why: r.end?.why ?? null, hits: r.hits,
      minRange: r0(Math.min(...rows.filter(k => k.t > 2).map(k => k.rng))),
      hunterMinV: +Math.min(...rows.filter(k => k.t > 3).map(k => k.av)).toFixed(1),
      youMinV: +Math.min(...rows.filter(k => k.t > 3).map(k => k.dv)).toFixed(1),
      lowest: r0(Math.min(...rows.map(k => Math.min(k.dy, k.ay)))),
      counterAt: i0 < 0 ? null : +rows[i0].t.toFixed(1),
      lockBefore300: +(longest(before, k => locked(k)) * r.dt).toFixed(2),
      lockBefore450: +(longest(before, k => locked(k, 450)) * r.dt).toFixed(2),
      lockAfter: secs(after, k => locked(k), r.dt),
      lockRunAfter: +(longest(after, k => locked(k)) * r.dt).toFixed(2),
      // Behind me and going my way, inside 300 m, nose on me or not.
      behindAfter: secs(after, k => k.dAta > 120 && k.dH < 60 && k.rng < 300, r.dt),
      // Anywhere in my rear half inside 300 m: following me round counts.
      rearAfter: secs(after, k => k.dAta > 100 && k.rng < 300, r.dt),
      // He in front of me, his tail to me.
      inFrontAfter: secs(after, k => k.dAta < 60 && k.aAta > 120 && k.rng < 400, r.dt),
      headOnPasses: after.filter((k, j) => j > 0 && k.dAta < 45 && k.aAta < 45 && k.rng < 150 && !(after[j - 1].dAta < 45 && after[j - 1].aAta < 45 && after[j - 1].rng < 150)).length,
    };
  };
  out.lock = {};
  out.lock.without = nearbyRuns(L, demo('without'), r => {
    const rows = shapeRows(r, 1, 0);
    return { ...common(r, rows), tailSecs: secs(rows, onTail, r.dt) };
  });
  out.lock.move = nearbyRuns(L, demo('move'), r => {
    const rows = shapeRows(r, 1, 0);
    const diving = rows.filter(k => k.dPh === 'dive');
    return { ...common(r, rows), phases: [...new Set(rows.map(k => k.dPh))],
             tailInDive: diving.length ? +(diving.filter(onTail).length / diving.length).toFixed(2) : null,
             diveRange: diving.length ? r0(diving.reduce((s, k) => s + k.rng, 0) / diving.length) : null };
  });
  out.lock.flat = nearbyRuns(L, demo('flat'), r => {
    const rows = shapeRows(r, 1, 0);
    return { ...common(r, rows) };
  });
  out.lock.meet = nearbyRuns(L, demo('meet'), r => {
    const rows = shapeRows(r, 1, 0);
    return { ...common(r, rows), phases: [...new Set(rows.map(k => k.dPh))] };
  });
  out.lock.counter = nearbyRuns(L, demo('counter'), r => {
    const rows = shapeRows(r, 1, 0);
    const iChop = rows.findIndex(k => k.dPh === 'chop');
    const chop = rows.filter(k => k.dPh === 'chop');
    const o = iChop < 0 ? null : overshoot(rows, Math.max(0, iChop - Math.round(1 / r.dt)), r.dt);
    const w15 = o ? rows.slice(o.i, o.i + Math.round(15 / r.dt)) : [];
    const w10 = o ? rows.slice(o.i, o.i + Math.round(10 / r.dt)) : [];
    const youHits = hitTimes(r, 1);
    return { ...common(r, rows), chopAt: iChop < 0 ? null : +rows[iChop].t.toFixed(1),
             chopBehind: chop.length ? +(chop.filter(k => k.dAta > 120 && k.dH < 60).length / chop.length).toFixed(2) : 0,
             chopRange: iChop < 0 ? null : r0(rows[iChop].rng), overshoot: o,
             heInFront: secs(w15, k => k.dAta < 60 && k.aAta > 120 && k.rng < 400, r.dt),
             heRuns: o ? rows.slice(o.i, o.i + Math.round(8 / r.dt)).some(k => k.aPh === 'extend') : false,
             youShot: secs(w15, k => k.dO, r.dt),
             heBack: secs(w10, onTail, r.dt), youHitsAfter: o ? youHits.filter(t => t >= o.t - 0.5).length : 0 };
  });
}

// On his tail's chop demos (`close`, `lag`) were retired on 2026-11-07
// (reviews/dfn-ot.md, "Ascendancy"): under the eyes the chopper no longer
// chops into a fly-past, and lagging out wide is the lockstep turn the
// lesson's Ninja replaces. Its Dip, Flip and Ninja are test_dogfight_dfn_ot's.

console.log(JSON.stringify(out));
