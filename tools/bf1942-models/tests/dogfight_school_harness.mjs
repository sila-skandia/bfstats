// The dogfight school under node (features/dogfight-school): the Spitfire
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
import { createPilot, geometry, situation, gunOf, PLANS } from './dogfight-pilot.js';
import { runDuel, placePlane, DUEL_DT, KILL_HITS, strikesAirframe } from './dogfight-duel.js';
import { LESSONS, demoSides, KEY_WORDS, fighterRank } from './dogfight-lessons.js';
import { coach, TONE } from './dogfight-coach.js';
import { toYou } from './dogfight-live.js';

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

// --- the stick's signs, on the Spitfire's own tables -------------------------
{
  const probe = (input, value) => {
    const p = plane();
    p.setInput(input, value);
    for (let i = 0; i < 15; i++) p.integrate(DT);
    const s = st(p), b = basis(s.orientation);
    return { noseY: b.F[1], noseX: b.F[0], rightY: b.R[1] };
  };
  out.signs = { pitchMinus: probe('c_PIPitch', -1), rollPlus: probe('c_PIRoll', 1), yawPlus: probe('c_PIYaw', 1) };
}

// --- what the airframe does: the numbers the lessons quote -------------------
{
  // Straight up from 70 m/s: the speed shed a second over the first three.
  const p = plane({ speed: 70, altitude: 150 });
  const speeds = [];
  fly(p, 4, (s, t) => { if (Math.abs(t - Math.round(t)) < DT / 2) speeds.push(len(s.velocity)); return pointNose(s, [0, 1, 0.02], { fine: 10 }); });
  out.vertical = { speeds: speeds.map(r1), shedPerSecond: r1((speeds[1] - speeds[3]) / 2) };
  // A 45 degree dive from 700 m at full throttle, ten seconds.
  const d = plane({ speed: 60, altitude: 700 });
  fly(d, 10, s => pointNose(s, along(s, -45), { fine: 8 }));
  out.dive45 = { speed: r1(len(st(d).velocity)) };
  // The steadiest climb: the height gained a second over 10..25 s at each angle.
  out.climbs = {};
  for (const angle of [10, 20, 30, 45]) {
    const c = plane({ speed: 55, altitude: 200 });
    let y0 = 0;
    fly(c, 25, (s, t) => { if (Math.abs(t - 10) < DT / 2) y0 = s.position[1]; return pointNose(s, along(s, angle), { fine: 8 }); });
    out.climbs[angle] = { rate: r1((st(c).position[1] - y0) / 15), speed: r1(len(st(c).velocity)) };
  }
  // The throttle: held back (S, reverse thrust) against shut, from 65 m/s level.
  for (const thr of [0, -1]) {
    const c = plane({ speed: 65, altitude: 400 });
    const speeds = [];
    fly(c, 10, (s, t) => { if (Math.abs(t - Math.round(t)) < DT / 2) speeds.push(len(s.velocity)); return { ...pointNose(s, along(s, 0), { fine: 8 }), throttle: thr }; });
    out[`throttle${thr}`] = speeds.map(r1);
  }
  // A full pull from wings level: the pitch rate over the first second and a half.
  out.pullRate = {};
  for (const v of [20, 40, 55, 70]) {
    const c = plane({ speed: v });
    let best = 0;
    c.setInput('c_PIPitch', -1);
    for (let i = 0; i < 1.5 / DT; i++) {
      c.integrate(DT);
      const s = st(c), b = basis(s.orientation);
      best = Math.max(best, s.angularVelocity[0] * b.R[0] + s.angularVelocity[1] * b.R[1] + s.angularVelocity[2] * b.R[2]);
    }
    out.pullRate[v] = r1(best * 180 / Math.PI);
  }
  // The hardest sustained turn: the heading's rate over 10..25 s, and the height it costs.
  const turn = plane({ speed: 55, altitude: 500 });
  let yaw0 = 0, y0 = 0, turned = 0, last = null;
  fly(turn, 25, (s, t) => {
    const yaw = Math.atan2(s.velocity[0], -s.velocity[2]);
    if (t >= 10 && last !== null) { let dd = yaw - last; if (dd > Math.PI) dd -= 2 * Math.PI; if (dd < -Math.PI) dd += 2 * Math.PI; turned += dd; }
    if (Math.abs(t - 10) < DT / 2) { yaw0 = yaw; y0 = s.position[1]; }
    last = yaw;
    return hardTurn(s, 1);
  });
  out.turn = { rate: r1(Math.abs(turned) * 180 / Math.PI / 15), sink: r1((y0 - st(turn).position[1]) / 15), speed: r1(len(st(turn).velocity)) };
}

// --- the hands -----------------------------------------------------------------
{
  // The nose onto a direction 90 degrees right, and one 30 left and 20 up.
  const settle = dir => {
    const p = plane({ speed: 60 });
    let at = null, worst = 0, closest = 180;
    // The aim's trim memory, as the pilots carry it.
    const mem = {};
    fly(p, 10, (s, t) => {
      const k = pointNose(s, dir, { fine: 8, mem, dt: DT });
      closest = Math.min(closest, k.off);
      if (at === null && k.off < 3) at = t; else if (at !== null) worst = Math.max(worst, k.off);
      return k;
    });
    return { at: at === null ? null : r1(at), worstAfter: r1(worst), closest: r1(closest) };
  };
  out.point = { right: settle([1, 0, 0]), leftUp: settle([-0.48, 0.34, -0.81]) };
  // Holding a 60 degree bank.
  const b = plane({ speed: 55, altitude: 500 });
  const banks = [];
  fly(b, 6, (s, t) => { if (t > 3) banks.push(bankOf(s.orientation).bank); return bankAndPull(s, 60, 0.5); });
  out.bankHold = { min: r1(Math.min(...banks)), max: r1(Math.max(...banks)) };
}

// --- the guns ------------------------------------------------------------------
out.gun = gunOf({ speed: 400, reach: 600, span: 2.5, converge: 1.6 });
out.gunDefault = gunOf({ speed: 0 });
{
  // A round through the wing from behind strikes; one a metre over it, or
  // between the wing and the tail, does not.
  const target = { position: [0, 300, 0], orientation: { x: 0, y: 0, z: 0, w: 1 } };
  out.strikes = {
    wing: strikesAirframe([3, 299.8, 50], [3, 299.8, -50], target),
    over: strikesAirframe([3, 301.5, 50], [3, 301.5, -50], target),
    between: strikesAirframe([3, 310, 2.5], [3, 290, 2.5], target),
  };
}

// --- the coach and the plans ---------------------------------------------------
{
  const me = { position: [0, 300, 0], velocity: [0, 0, -55], orientation: { x: 0, y: 0, z: 0, w: 1 }, angularVelocity: [0, 0, 0] };
  const behind = { position: [0, 300, 200], velocity: [0, 0, -60], orientation: { x: 0, y: 0, z: 0, w: 1 }, angularVelocity: [0, 0, 0] };
  const ahead = { position: [0, 300, -200], velocity: [0, 0, -50], orientation: { x: 0, y: 0, z: 0, w: 1 }, angularVelocity: [0, 0, 0] };
  out.situations = { defensive: situation(geometry(me, behind)), offensive: situation(geometry(me, ahead)) };
  const lesson = LESSONS[0];
  out.coach = {
    onTail: coach(lesson, { phase: 'dive' }, me, behind),
    guns: coach(null, null, me, ahead),
    slow: coach(null, null, { ...me, velocity: [0, 0, -20] }, ahead),
    ground: coach(null, null, { ...me, position: [0, 30, 0], velocity: [0, -20, -50] }, ahead),
  };
  out.plans = Object.keys(PLANS);
  out.keyWords = Object.keys(KEY_WORDS);
  out.toYou = ['Climbing above him, out of his reach', 'He is on my tail: breaking into him'].map(toYou);
  out.fighterRank = ['Spitfire', 'BF109', 'B17', 'Stuka'].map(fighterRank);
}

// --- every lesson's fights, from nine nearby starts --------------------------
out.lessons = LESSONS.map(L => ({
  id: L.id, title: L.title, ace: L.ace.plan, coachPhases: Object.keys(L.coach ?? {}),
  coachKeys: [...new Set(Object.values(L.coach ?? {}).flatMap(c => c.keys ?? []))],
  says: Object.keys(PLANS[L.ace.plan]?.says ?? {}),
  demos: L.demos.map(d => {
    const runs = [];
    for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
      const sides = demoSides(L, d);
      sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
      const r = runDuel({ makePlane, seconds: L.seconds, groundAt: () => 0, sides });
      runs.push({ winner: r.end ? r.end.winner : null, why: r.end?.why ?? null, t: r.end ? r1(r.end.t) : null, hits: r.hits,
                  events: r.events.length, rounds: r.rounds.length });
    }
    return { id: d.id, seat: d.seat, ace: d.ace ?? null, runs };
  }),
}));
out.killHits = KILL_HITS;

// --- the ace against every other pilot, from ten starts each ----------------
{
  const STARTS = [
    [{ at: [0, 360, -900], headingDeg: 180, speed: 60 }, { at: [0, 300, 0], headingDeg: 0, speed: 58 }],
    [{ at: [40, 320, 500], headingDeg: 0, speed: 62 }, { at: [0, 300, 0], headingDeg: 0, speed: 55 }],
    [{ at: [30, 300, -350], headingDeg: 0, speed: 60 }, { at: [0, 300, 0], headingDeg: 0, speed: 62 }],
    [{ at: [0, 250, -700], headingDeg: 90, speed: 55 }, { at: [0, 500, 0], headingDeg: 0, speed: 60 }],
    [{ at: [-700, 320, -300], headingDeg: 90, speed: 60 }, { at: [0, 320, 0], headingDeg: 0, speed: 60 }],
  ];
  const rows = {};
  for (const opp of ['chaser', 'meetTheDive', 'shallowFollow', 'patientAttacker', 'circler', 'unaware']) {
    const row = { wins: 0, losses: 0, hitsBy: 0, hitsOn: 0 };
    for (const [a, b] of STARTS) for (const dv of [-3, 3]) {
      const r = runDuel({ makePlane, seconds: 90, groundAt: () => 0,
        sides: [{ plan: 'ace', start: a, skill: 1 }, { plan: opp, start: { ...b, speed: b.speed + dv }, skill: 0.85, memory: { dir: 1 } }] });
      if (r.end?.winner === 0) row.wins++;
      if (r.end?.winner === 1) row.losses++;
      row.hitsBy += r.hits[0];
      row.hitsOn += r.hits[1];
    }
    rows[opp] = row;
  }
  out.aceBench = rows;
}

console.log(JSON.stringify(out));
