// A plane shot down in the air, flown under node on the page's own flight law
// (`viewer/aircraft.js`) and the wreck pass that steps it
// (`viewer/world-vehicle-tick.js` `stepFallingWrecks`). Run by
// `tests/test_plane_wreck.py`; prints one JSON blob.
//
// Retail's rule, read on the server binary (ledger HP-15, HP-19, HP-24,
// PHY-14 and the wing rows this change adds): message 0x15 stops the Engines
// and sets the destroyed byte, which gates the pilot's input and nothing
// else. `Wing::handleMessage` 0x08250bf0 writes `+0xed` on 0x15 and leaves
// the lift pair alone, and neither `Wing::handleUpdate` 0x08250950 nor
// `PhysicsWing::updatePhysics` 0x0824ed10 reads the byte. So a wreck is the
// same airframe with a dead engine and a stick nobody moves: it glides.
//
// The Spitfire is El Alamein's, the table `dogfight_school_harness.mjs` flies.

import * as THREE from 'three';
import { Aircraft } from './aircraft.js';
import { placePlane } from './dogfight-duel.js';
import * as tick from './world-vehicle-tick.js';

const DT = 1 / 30;
const r1 = v => Math.round(v * 10) / 10;
const r3 = v => Math.round(v * 1000) / 1000;

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

/** A Spitfire in the air, heading -z, flown `lead` seconds on `stick` first so
 *  the kill finds it in a settled attitude (a turn is entered, not placed). */
function flown({ speed = 70, altitude = 200, pitchDeg = 0, lead = 0, stick = null } = {}) {
  const p = new Aircraft(spitfireNode(), null, { cockpit: false });
  p.groundHeight = () => 0;
  placePlane(p, { at: [0, altitude, 0], headingDeg: 0, pitchDeg, speed });
  for (let i = 0; i < Math.round(lead / DT); i++) {
    p.setInput('c_PIThrottle', 1);
    p.setInput('c_PIPitch', stick?.pitch ?? 0);
    p.setInput('c_PIRoll', stick?.roll ?? 0);
    p.setInput('c_PIYaw', 0);
    p.integrate(DT);
  }
  return p;
}

/** Fly `p` with `step` until it is down (its origin at its ride height) or
 *  `limit` seconds pass. What a player would see: where it came down, how
 *  long that took, and the angle of the path there. */
function descend(p, step, limit = 90) {
  const s = p.state;
  const ride = p.spec?.groundClearance ?? 1.2;
  const x0 = s.position.x, y0 = s.position.y, z0 = s.position.z;
  const v0 = s.velocity.length();
  let t = 0, at10 = null, minSpeed = Infinity, maxY = y0, down = false;
  const trace = [];
  while (t < limit) {
    step(DT);
    t += DT;
    const v = s.velocity;
    minSpeed = Math.min(minSpeed, v.length());
    maxY = Math.max(maxY, s.position.y);
    if (trace.length < 400 && Math.round(t / DT) % 15 === 0) {
      trace.push([r1(t), r1(s.position.x - x0), r1(s.position.y), r1(s.position.z - z0), r1(v.x), r1(v.y), r1(v.z)]);
    }
    if (!at10 && t >= 10) {
      at10 = { distance: r1(Math.hypot(s.position.x - x0, s.position.z - z0)), height: r1(s.position.y), speed: r1(v.length()) };
    }
    if (s.position.y <= ride + 0.25) { down = true; break; }
  }
  const distance = Math.hypot(s.position.x - x0, s.position.z - z0);
  const sink = y0 - s.position.y;
  return {
    down, seconds: r1(t), distance: r1(distance), sink: r1(sink),
    glideAngle: r1(Math.atan2(sink, distance) * 180 / Math.PI),
    speedAtKill: r1(v0), speedAtEnd: r1(s.velocity.length()), minSpeed: r1(minSpeed),
    climbed: r1(maxY - y0), at10, trace,
  };
}

const wreckWorld = p => ({ falling: new Set([p]), coasting: new Map() });

/** Shot down: the wreck pass is the only thing that steps it. */
function wreck(options) {
  const p = flown(options);
  p.fallingWreck = true;
  const world = wreckWorld(p);
  return descend(p, dt => tick.stepFallingWrecks(world, dt));
}

/** The reference a wreck is held to: the same airframe on its own law with
 *  its engine stopped (0x15, PHY-14) and nobody writing an input. */
function deadStick(options) {
  const p = flown(options);
  p.engineRunning = false;
  p.setInput('c_PIFire', 0);
  p.setInput('c_PIAltFire', 0);
  return descend(p, dt => p.integrate(dt));
}

const CASES = {
  level: { speed: 70, altitude: 200 },
  climb: { speed: 70, altitude: 200, pitchDeg: 20 },
  dive: { speed: 70, altitude: 200, pitchDeg: -20 },
  turn: { speed: 70, altitude: 200, lead: 1.5, stick: { roll: 1, pitch: 0 } },
};

const out = { wreck: {}, deadStick: {} };
for (const [name, options] of Object.entries(CASES)) {
  out.wreck[name] = wreck(options);
  out.deadStick[name] = deadStick(options);
}

// --- the neighbours ----------------------------------------------------------
// A pilot killed (or bailed out) with the hull alive: the coasting list.
{
  const p = flown(CASES.level);
  const world = { falling: new Set(), coasting: new Map([[p, null]]) };
  out.pilotless = descend(p, dt => tick.stepCoastingHulls(world, dt));
}

// Critical hit points, the pilot alive and hands off: the Engines stop (0x14,
// PHY-14) and every Wing's lift pair is scaled by where it sits across the
// hull (`Wing::handleMessage` 0x08250d70..0x08250ee0).
{
  const p = flown(CASES.level);
  const full = p.surfaces.map(s => s.coeff);
  const radius = p.criticalLiftRadius?.() ?? null;
  p.engineRunning = false;
  p.criticalLift?.(0);
  const factors = Object.fromEntries(p.surfaces.map((s, i) => [s.id, r3(full[i] ? s.coeff / full[i] : 0)]));
  const attach = Object.fromEntries(p.surfaces.map(s => [s.id, s.attach ? r3(s.attach.x) : null]));
  const run = descend(p, dt => p.integrate(dt));
  // The same hull hit on its other side (`getLastHitPlace().x < 0`).
  const q = flown(CASES.level);
  q.criticalLift?.(-1);
  const mirrored = Object.fromEntries(q.surfaces.map((s, i) => [s.id, r3(full[i] ? s.coeff / full[i] : 0)]));
  // Recovery (0x13) puts the template's pair back.
  q.fullLift?.();
  const restored = q.surfaces.every((s, i) => s.coeff === full[i]);
  // Turned a quarter turn, the lateral axis is the world's z and every wing
  // sits at the same world x: the engine reads world x, not the hull's own.
  const t = flown(CASES.level);
  placePlane(t, { at: [0, 200, 0], headingDeg: 90, speed: 70 });
  t.criticalLift?.(0);
  const quarter = Object.fromEntries(t.surfaces.map((s, i) => [s.id, r3(full[i] ? s.coeff / full[i] : 0)]));
  out.critical = { built: typeof p.criticalLift === 'function', radius: radius == null ? null : r3(radius),
                   factors, attach, mirrored, restored, quarter, run };
}

// A wreck that was critical when it died keeps the scaled pair: 0x15 writes
// the destroyed byte and nothing else on a Wing (0x08250d5a).
{
  const p = flown(CASES.level);
  p.criticalLift?.(0);
  const before = p.surfaces.map(s => s.coeff);
  p.fallingWreck = true;
  const world = wreckWorld(p);
  for (let i = 0; i < 30; i++) tick.stepFallingWrecks(world, DT);
  out.criticalWreckKeepsLift = p.surfaces.every((s, i) => s.coeff === before[i]);
}

// What the wreck pass does to the controls and the engine.
{
  const p = flown({ ...CASES.level });
  p.setInput('c_PIPitch', -0.6);
  p.setInput('c_PIRoll', 0.4);
  p.setInput('c_PIFire', 1);
  p.fallingWreck = true;
  const world = wreckWorld(p);
  for (let i = 0; i < 5; i++) tick.stepFallingWrecks(world, DT);
  out.controls = { pitch: p.input('c_PIPitch'), roll: p.input('c_PIRoll'), fire: p.input('c_PIFire'),
                   engineRunning: p.engineRunning, lift: p.surfaces.every(s => s.coeff !== 0 || !s.id) };
}

// The Armor's last hit place (`setLastHitPlace`), the crossing that reads it,
// and the Wings' answer through whoever steps the drive.
{
  const { VehicleDamageSet } = await import('./vehicle-damage.js');
  const set = new VehicleDamageSet();
  set.originX = owner => (owner === 7 ? 100 : null);
  const hull = set.add(7, { hitpoints: 100, maxHitpoints: 100, criticalDamage: 20 }, { name: 'Spitfire' });
  // A round on the hull's low-x side while it is still safe, then the one
  // that takes it critical on the other side: the crossing keeps the latter.
  set.applyHit({ owner: 7, damage: 30, point: [96, 50, 0] });
  const safe = { flagged: hull.criticalFlagged, place: hull.lastHitPlaceX, critical: hull.criticalHitX };
  set.applyHit({ owner: 7, damage: 55, point: [103, 50, 0] });
  const crossed = { flagged: hull.criticalFlagged, place: hull.lastHitPlaceX, critical: hull.criticalHitX };
  // A later hit moves the place and not what the Wings were told.
  set.applyHit({ owner: 7, damage: 1, point: [95, 50, 0] });
  const later = { place: hull.lastHitPlaceX, critical: hull.criticalHitX };

  const p = flown(CASES.level);
  const full = p.surfaces.map(x => x.coeff);
  const left = () => r3(p.surfaces.find(x => x.id === 'SpitfireRudderFrontLeft').coeff / full[p.surfaces.findIndex(x => x.id === 'SpitfireRudderFrontLeft')]);
  const fresh = { hitPoints: 100, criticalFlagged: false, criticalHitX: 0, destroyed: false };
  tick.syncCriticalLift(p, fresh);
  const before = left();
  tick.syncCriticalLift(p, { ...fresh, criticalFlagged: true, criticalHitX: -2 });
  const mirrored = left();
  // Destroyed while critical: the byte does not move, and neither do the Wings.
  tick.syncCriticalLift(p, { ...fresh, criticalFlagged: true, criticalHitX: -2, destroyed: true });
  const dead = left();
  // Repaired above the threshold (0x13).
  tick.syncCriticalLift(p, fresh);
  const repaired = left();
  hull.reset();
  out.hitPlace = { safe, crossed, later, afterReset: { place: hull.lastHitPlaceX, critical: hull.criticalHitX },
                   sync: { before, mirrored, dead, repaired } };
}

process.stdout.write(JSON.stringify(out) + '\n');
