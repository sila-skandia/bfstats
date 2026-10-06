// Fires the artillery rockets, and a few motor-carried ones, under node through
// the real `viewer/gunfire.js`, and measures where they come down.
//
// Every round below is the `fireArms` block `bf42/assemble.py` stamps into the
// shipped glb (`test_rocket_flight.py` checks the copies against the trees when
// they are on disk), and every body is a box the size of the drawn one, so the
// drag term's frontal area is a real measurement. The launcher stands on a flat
// 16 km tile at y = 0 and fires down -Z from 2 m up, pitched by the angle.
//
// The questions, in the order `features/rocket-flight/README.md` asks them:
//
//   gravity  does a rocket that declares no `gravityModifier` fall (IMP-7)
//   range    does each artillery rocket land, and how far out, at 30 and 45 deg
//   bullets  does an invisible round (and a tracer) fall by its own word, and
//            does a retail rifle round still fly flat

import * as THREE from 'three';
import { GunFire } from './gunfire.js';
import { fireBarrel } from './round-launch.js';
import { RocketMotor, isAirMotor, rocketMotorsOf } from './rocket-motor.js';
import { releaseSpeed } from './bomb-release.js';
import { GRAVITY } from './physics.js';
import { WorldCollider } from './world-collider.js';
import { buildHeightfield } from './heightfield.js';

const out = {};

// --- the rounds, off the glbs -----------------------------------------------

const ROCKET_ENGINE = {
  engineType: 'c_ETRocket', torque: 50.0, differential: 30.0,
  noPropellerEffectAtSpeed: 1000.0, maxRotation: [0, 0, 5000],
  maxSpeed: [0, 0, 100000], acceleration: [0, 0, 100000],
};

/** `Objects/Vehicles/Land/<x>Rocket/{Weapons,Physics}.con`, as baked. */
export const ROUNDS = {
  // vanilla Katyusha.glb, `KatyushaFireArmsBundle`
  KatyushaRocket: {
    velocity: 45.0, body: [0.268, 0.268, 2.042],
    projectile: {
      template: 'KatyushaRocket', kind: 'rocket', timeToLive: 20.0,
      material: 240, mass: 20.0, drag: 1.0, hasPointPhysics: false,
      stopAtEndEffect: false,
      damage: { radius: 15.0, material2: 201, damageType: 1,
                hasCollisionEffect: true, dieAfterColl: true },
      parts: [
        { template: 'KatyushaRocket_Wing', kind: 'Wing', position: [0, 0, 1.5],
          rotation: [0, 0, 0], wingLift: 0.1, flapLift: 0.0, pitchOffset: 0.0 },
        { template: 'KatyushaRocket_Engine', kind: 'Engine', position: [0, 0, 2],
          rotation: [0, 0, 0], ...ROCKET_ENGINE },
      ],
    },
  },
  // desertcombat MLRS.glb, `MLRSFireArmsBundle`
  MLRSRocket: {
    velocity: 100.0, body: [0.225, 0.225, 1.488],
    projectile: {
      template: 'MLRSRocket', kind: 'rocket', timeToLive: 20.0,
      material: 715, mass: 20.0, drag: 1.0, hasPointPhysics: false,
      stopAtEndEffect: false,
      damage: { radius: 25.0, material2: 714, damageType: 1,
                hasCollisionEffect: true, dieAfterColl: true },
      parts: [
        { template: 'MLRSRocket_Wing', kind: 'Wing', position: [0, 0, 1.4],
          rotation: [0, 0, 0], wingLift: 0.1, flapLift: 0.0, pitchOffset: 0.0 },
        { template: 'MLRSRocket_Engine', kind: 'Engine', position: [0, 0, 2],
          rotation: [0, 0, 0], ...ROCKET_ENGINE },
      ],
    },
  },
  // desertcombat BM21.glb, `BM21FireArmsBundle`
  BM21_Rocket: {
    velocity: 90.0, body: [0.268, 0.268, 2.042],
    projectile: {
      template: 'BM21_Rocket', kind: 'rocket', timeToLive: 20.0,
      material: 715, mass: 20.0, drag: 1.0, hasPointPhysics: false,
      stopAtEndEffect: false,
      damage: { radius: 25.0, material2: 716, damageType: 1,
                hasCollisionEffect: true, dieAfterColl: true },
      parts: [
        { template: 'KatyushaRocket_Wing', kind: 'Wing', position: [0, 0, 1.5],
          rotation: [0, 0, 0], wingLift: 0.1, flapLift: 0.0, pitchOffset: 0.0 },
        { template: 'BM21_Rocket_Engine', kind: 'Engine', position: [0, 0, 2],
          rotation: [0, 0, 0], ...ROCKET_ENGINE },
      ],
    },
  },
  // desertcombat SCUD-B.glb, `SCUD-BRocketlauncher`
  'SCUD-BRocket': {
    velocity: 90.0, body: [1.548, 1.519, 10.397],
    projectile: {
      template: 'SCUD-BRocket', kind: 'rocket', timeToLive: 40.0,
      material: 704, mass: 1000.0, drag: 0.1, hasPointPhysics: false,
      stopAtEndEffect: false,
      damage: { radius: 50.0, material2: 703, damageType: 1,
                hasCollisionEffect: true, dieAfterColl: true },
      parts: [
        { template: 'SCUD-BRocket_Wing', kind: 'Wing', position: [0, 0, 4.5],
          rotation: [0, 0, 0], wingLift: 0.1, flapLift: 0.0, pitchOffset: 0.0 },
        { template: 'SCUD-BRocket_Engine', kind: 'Engine', position: [0, 0, 5.5],
          rotation: [0, 0, 0], ...ROCKET_ENGINE },
      ],
    },
  },
};

/** Invisible rounds, off the glbs: what the exporter calls `kind: 'bullet'`. */
export const BULLETS = {
  // vanilla BritishSoldier__Bar1918.fp.glb: every retail rifle and MG round
  // declares `gravityModifier 0`
  barProjectile: {
    velocity: 1000.0,
    projectile: { template: 'barProjectile', kind: 'bullet', timeToLive: 1.0,
                  gravity: 0.0, material: 222,
                  damage: { hasCollisionEffect: true, dieAfterColl: true } },
  },
  // desertcombat AH64.glb `M230Cannon`
  '25mmChaingunProjectile': {
    velocity: 1000.0,
    projectile: { template: '25mmChaingunProjectile', kind: 'bullet',
                  timeToLive: 4.0, gravity: 0.2, material: 674,
                  damage: { radius: 5.0, material2: 673, damageType: 1,
                            hasCollisionEffect: true } },
  },
  // desertcombat A10_C.glb `A10_CBU87`: no `gravityModifier`
  CBU87Prj: {
    velocity: 15.0,
    projectile: { template: 'CBU87Prj', kind: 'bullet', timeToLive: 10.0,
                  material: 853, mass: 25.0, drag: 1.6,
                  damage: { radius: 15.0, material2: 853, damageType: 1,
                            hasCollisionEffect: true, dieAfterColl: true },
                  endEffect: 'e_ExplGranade' },
  },
  // desertcombat Browning.glb: a flat round, every second one a tracer that
  // declares `gravityModifier 1`
  '50cal_Projectile': {
    velocity: 1000.0,
    tracer: { template: '50cal_Tracer_Projectile', interval: 2,
              timeToLive: 2.0, scaler: 50.0, gravity: 1.0 },
    projectile: { template: '50cal_Projectile', kind: 'bullet', timeToLive: 2.0,
                  gravity: 0.0 },
  },
  // vanilla's tracer, as a fresh glb carries it and as a stale one does
  vanillaTracer: {
    velocity: 1000.0,
    tracer: { template: 'Tracer_Projectile', interval: 2, timeToLive: 3.0,
              scaler: 50.0, gravity: 0.0 },
    projectile: { template: 'BrowningProjectile', kind: 'bullet',
                  timeToLive: 1.5, gravity: 0.0 },
  },
  staleTracer: {
    velocity: 1000.0,
    tracer: { template: 'Tracer_Projectile', interval: 2, timeToLive: 3.0,
              scaler: 50.0 },
    projectile: { template: 'BrowningProjectile', kind: 'bullet',
                  timeToLive: 1.5, gravity: 0.0 },
  },
  // DC's 50 cal from a glb baked before the tracer carried its gravity, with
  // a fresh damage table (the damage layer): the tracer's row says 1.
  tableTracer: {
    velocity: 1000.0,
    tracer: { template: '50cal_Tracer_Projectile', interval: 2,
              timeToLive: 2.0, scaler: 50.0 },
    projectile: { template: '50cal_Projectile', kind: 'bullet', timeToLive: 2.0,
                  gravity: 0.0 },
    table: { '50cal_tracer_projectile': { material: 681, hasOnTimeEffect: false,
                                          gravity: 1 } },
  },
  // ...and vanilla's tracer from the same mix: its row declares 0.0.
  tableVanillaTracer: {
    velocity: 1000.0,
    tracer: { template: 'Tracer_Projectile', interval: 2, timeToLive: 3.0,
              scaler: 50.0 },
    projectile: { template: 'BrowningProjectile', kind: 'bullet',
                  timeToLive: 1.5, gravity: 0.0 },
    table: { tracer_projectile: { material: 225, hasOnTimeEffect: false,
                                  gravity: 0 } },
  },
};

/** The motor-carried rockets of Desert Combat (and DC Final's TOW), off their
 *  glbs: `[velocity, timeToLive, gravity, mass, drag, hasPointPhysics,
 *  torque, differential, noPropellerEffectAtSpeed, body]`. Every engine is a
 *  `c_ETRocket` at `0/0/2` (the SA-3's at 3) with `maxRotation 0/0/5000` and
 *  `maxSpeed` / `acceleration 0/0/100000` (the Maverick's ten times that). */
export const MOTORS = {
  HydraRocket: [150, 20, 0, 5, 1.0, false, 250, 150, 1000, [0.237, 0.237, 1.293]],
  HellfireRocket: [350, 50, 0, 5, 2.0, false, 150, 90, 1000, [0.221, 0.221, 1.612]],
  Aim9: [350, 20, 0, 20, 0.5, false, 50, 30, 1000, [0.387, 0.447, 2.938]],
  'AA-10': [500, 12, 0, 20, 0.5, false, 50, 30, 1000, [0.607, 0.607, 3.871]],
  Rocket_MagicII: [300, 50, 0, 10, 0.1, false, 250, 150, 1000, [0.522, 0.522, 2.983]],
  Rocket_Maverick: [200, 20, 0.1, 20, 0.3, false, 150, 30, 1000, [0.504, 0.471, 2.542]],
  AT2Rocket: [350, 50, 0, 5, 1.0, false, 150, 90, 1000, [1.441, 1.461, 1.6]],
  StingerMissile: [300, 1.3, 0, 20, 1.0, undefined, 30, 15, 1000, [0.083, 0.083, 1.291]],
  'SA-3Rocket': [250, 1.3, 0, 500, 0.08, undefined, 100, 30, 250, [1.622, 1.622, 7.008]],
  DefenderTOW: [150, 25, 0, 500, 0.1, undefined, 150, 90, 1000, [0.129, 0.112, 0.853]],
};

// --- a world ----------------------------------------------------------------

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The four fields of a three.js Mesh `collision.js` reads (as in
 *  `bomb_release_harness.mjs`). */
function fakeMesh(positions) {
  const node = {
    isMesh: true, name: 'terrain', parent: null, children: [],
    userData: { kind: 'terrain' },
    matrixWorld: { elements: IDENTITY },
    geometry: {
      attributes: {
        position: { array: Float32Array.from(positions),
                    count: positions.length / 3 },
      },
      index: null,
      userData: { defenseMaterial: 0, collision: false },
    },
    traverse(fn) { fn(node); },
  };
  return node;
}

/** A flat terrain tile, `size` metres square in +x / -z, at y = `height`. */
function flatTile(size, height, spacing) {
  const positions = [];
  for (let iz = 0; iz < size / spacing; iz++) {
    for (let ix = 0; ix < size / spacing; ix++) {
      const x0 = ix * spacing, x1 = x0 + spacing;
      const z0 = -iz * spacing, z1 = z0 - spacing;
      positions.push(x0, height, z0, x1, height, z0, x1, height, z1);
      positions.push(x0, height, z0, x1, height, z1, x0, height, z1);
    }
  }
  return fakeMesh(positions);
}

const WORLD = 16384;

function world() {
  const field = buildHeightfield([flatTile(WORLD, 0, WORLD / 8)],
                                 { worldSize: WORLD, dim: 8 });
  return new WorldCollider({ heightfield: field, waterLevel: null });
}

/** A launcher with one barrel, pitched `degrees` up, `height` m over the
 *  ground, firing `round` (one of the tables above, by `name`). */
function launcher(round, name, degrees, height = 2) {
  const node = new THREE.Group();
  node.name = `${name}Launcher`;
  node.userData.fireArms = {
    projectile: round.projectile, roundOfFire: 1, magSize: 12, numOfMag: 10,
    velocity: round.velocity, input: 'c_PIFire', control: 'vehicle', muzzles: 1,
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = `${node.name} muzzle 1`;
  muzzle.userData.muzzle = { index: 0 };
  muzzle.rotation.x = degrees * Math.PI / 180;
  node.add(muzzle);
  const [w, h, l] = round.body;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, l),
                              new THREE.MeshBasicMaterial());
  body.name = `${node.name} projectile`;
  body.userData.projectileMesh = { template: name };
  node.add(body);
  const root = new THREE.Group();
  root.name = name;
  root.add(node);
  root.position.set(WORLD / 2, height, -64);
  root.updateMatrixWorld(true);
  return root;
}

/** One round, fired and flown until it lands or its fuse ends. */
function fly(name, degrees, { frame = 1 / 60, round = ROUNDS[name], height = 2,
                               marks = [1, 2, 5, 10] } = {}) {
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera(),
                             viewportHeight: () => 900 });
  guns.rand = () => 0.5;
  guns.collider = world();
  const [group] = guns.collect(launcher(round, name, degrees, height), {
    replace: true, speedScale: 1, maxRange: 1e6, roundLifetime: 'data',
    tracerLength: 'data',
  });
  const impacts = [];
  let t = 0;
  guns.onImpact = record => impacts.push({ record, at: t });
  guns.setFiring(group, true);
  guns.advance(frame);
  guns.setFiring(group, false);
  const shot = guns.projectiles[0];
  const start = shot.mesh.position.clone();
  let apex = start.y, maxSpeed = 0;
  const speedAt = {};
  for (let i = 0; i < 120 / frame && guns.projectiles.includes(shot); i++) {
    guns.advance(frame);
    t += frame;
    apex = Math.max(apex, shot.mesh.position.y);
    const speed = shot.velocity.length();
    maxSpeed = Math.max(maxSpeed, speed);
    for (const mark of marks) {
      if (speedAt[mark] === undefined && t >= mark - 1e-9) speedAt[mark] = round3(speed);
    }
  }
  // A contact with the ground, not the fuse running out in the air (that is
  // an `endOfLife` record at wherever the round had got to).
  const landing = impacts.find(i => i.record.kind === 'terrain') ?? null;
  const hit = landing?.record ?? null;
  const end = hit ? new THREE.Vector3(...hit.point) : shot.mesh.position;
  return {
    landed: !!hit,
    seconds: round3(landing?.at ?? t),
    range: round3(Math.hypot(end.x - start.x, end.z - start.z)),
    apex: round3(apex - start.y),
    endHeight: round3(end.y),
    maxSpeed: round3(maxSpeed),
    speedAt,
  };
}

out.range = {};
for (const name of Object.keys(ROUNDS)) {
  out.range[name] = {};
  for (const degrees of [30, 45]) out.range[name][degrees] = fly(name, degrees);
}
// The frame rate must not move the landing point much: the page runs at
// whatever the display does, the engine at 30 Hz.
out.frameRate = {
  at60: fly('MLRSRocket', 45, { frame: 1 / 60 }),
  at30: fly('MLRSRocket', 45, { frame: 1 / 30 }),
  at144: fly('MLRSRocket', 45, { frame: 1 / 144 }),
};

// --- motors: what each rocket's own Engine does to it ------------------------

/** A `MOTORS` row as the round `assemble.py` would bake. */
function motorRound(name) {
  const [velocity, ttl, gravity, mass, drag, point, torque, differential,
         fade, body] = MOTORS[name];
  const fast = name === 'Rocket_Maverick' ? 1000000 : 100000;
  return {
    velocity, body,
    projectile: {
      template: name, kind: 'rocket', timeToLive: ttl, gravity, mass, drag,
      ...(point === undefined ? {} : { hasPointPhysics: point }),
      damage: { damageType: 1, hasCollisionEffect: true, dieAfterColl: true },
      parts: [{
        template: `${name}_Engine`, kind: 'Engine',
        position: [0, 0, name === 'SA-3Rocket' ? 3 : 2], rotation: [0, 0, 0],
        engineType: 'c_ETRocket', torque, differential,
        noPropellerEffectAtSpeed: fade, maxRotation: [0, 0, 5000],
        maxSpeed: [0, 0, fast], acceleration: [0, 0, fast],
      }],
    },
  };
}

// The motor on its own, at the engine's 30 Hz: the throttle servo, the revs
// and the push, held at a constant speed so only the gearbox moves.
{
  const part = ROUNDS.MLRSRocket.projectile.parts[1];
  const motor = new RocketMotor(part);
  const ticks = [];
  for (let i = 1; i <= 120; i++) {
    const accel = motor.tick(1 / 30, 100, 10, false);
    if ([1, 3, 6, 9, 10, 30, 60, 120].includes(i)) {
      ticks.push({ tick: i, t1: round3(motor.t1), revs: round3(motor.revs),
                   accel: round3(accel) });
    }
  }
  const high = new RocketMotor(part);
  for (let i = 0; i < 120; i++) high.tick(1 / 30, 100, 1000, false);
  const wet = new RocketMotor(part);
  for (let i = 0; i < 60; i++) wet.tick(1 / 30, 100, 10, false);
  const wetPush = wet.tick(1 / 30, 100, -1, true);
  out.motorAlone = {
    ticks,
    ratio: round3(motor.ratio),
    // At 1000 m the speed term vanishes and K is the revs' own.
    highK: round3(high.accel / high.ratio), highRevs: round3(high.revs),
    wet: { push: wetPush, revs: wet.revs },
    // Which parts get a motor at all.
    motorsOf: {
      rocket: isAirMotor({ kind: 'Engine', engineType: 'c_ETRocket' }),
      torpedo: isAirMotor({ kind: 'Engine', engineType: 'c_ETTorpedo' }),
      plane: isAirMotor({ kind: 'Engine', engineType: 'c_ETPlane' }),
      wing: isAirMotor({ kind: 'Wing' }),
      silkworm: (rocketMotorsOf({ parts: [
        { kind: 'Engine', engineType: 'c_ETRocket' },
        { kind: 'Engine', engineType: 'c_ETTorpedo' }] }) || []).length,
      shell: rocketMotorsOf({ kind: 'shell' }),
    },
  };
}

// Level, 60 m up, where the air density is 0.94 of the ground's.
out.motor = {};
for (const name of Object.keys(MOTORS)) {
  out.motor[name] = fly(name, 0, { round: motorRound(name), height: 60,
                                   marks: [0.5, 1, 2, 5, 10, 20, 40] });
}

// --- expiry: only a round that sets `hasOnTimeEffect` bursts (PROX-7) --------

/** Shells off their glbs, with the damage table row `extract_map.py` writes. */
const EXPIRING = {
  // vanilla AA_Allies.glb: CRD_UNIFORM/0.8/1.4 at 300 m/s, hasOnTimeEffect 1
  AA_Allies_Projectile: {
    velocity: 300, body: [0.1, 0.1, 0.4],
    projectile: { template: 'AA_Allies_Projectile', kind: 'shell',
                  timeToLive: 0.8, gravity: 0.0, material: 228,
                  stopAtEndEffect: true, endEffect: 'e_FlakBig',
                  damage: { radius: 20.0, material2: 199, damageType: 4,
                            hasCollisionEffect: true, dieAfterColl: true } },
    entry: { material: 228, timeToLive: ['u', 0.8, 1.4, 0], hasOnTimeEffect: true,
             explodeNearEnemyDistance: 10.0, proximityFusePrimer: 0.1 },
  },
  // vanilla flak38.glb: CRD_UNIFORM/0.8/1.2
  Flak38_Projectile: {
    velocity: 300, body: [0.1, 0.1, 0.4],
    projectile: { template: 'Flak38_Projectile', kind: 'shell',
                  timeToLive: 0.8, gravity: 0.0, material: 228,
                  stopAtEndEffect: true, endEffect: 'e_FlakBig',
                  damage: { radius: 20.0, material2: 199, damageType: 4,
                            hasCollisionEffect: true } },
    entry: { material: 228, timeToLive: ['u', 0.8, 1.2, 0], hasOnTimeEffect: true,
             explodeNearEnemyDistance: 10.0 },
  },
  // desertcombat Shilka.glb: 1 s, 5 m splash, `hasOnTimeEffect 0` since DC
  // took its proximity fuse out
  ShilkaProjectile: {
    velocity: 1000, body: [0.05, 0.05, 0.2],
    projectile: { template: 'ShilkaProjectile', kind: 'shell', timeToLive: 1.0,
                  gravity: 0.0, material: 501, stopAtEndEffect: true,
                  damage: { radius: 5.0, material2: 500, damageType: 1,
                            hasCollisionEffect: true, dieAfterColl: true } },
    entry: { material: 501, hasOnTimeEffect: false },
  },
  // The same shell from assets baked before the word: the old burst.
  staleShilka: {
    velocity: 1000, body: [0.05, 0.05, 0.2],
    projectile: { template: 'ShilkaProjectile', kind: 'shell', timeToLive: 1.0,
                  gravity: 0.0, material: 501, stopAtEndEffect: true,
                  damage: { radius: 5.0, material2: 500, damageType: 1,
                            hasCollisionEffect: true, dieAfterColl: true } },
    entry: { material: 501 },
  },
};

/** One shell fired 80 degrees up with the fuse die at `roll`: what its
 *  expiry does and how far out. */
function expire(name, roll) {
  const round = EXPIRING[name];
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera(),
                             viewportHeight: () => 900 });
  guns.rand = () => roll;
  guns.collider = world();
  guns.projectileMaterials = { [round.projectile.template.toLowerCase()]: round.entry };
  const [group] = guns.collect(launcher(round, name, 80, 2), {
    replace: true, speedScale: 1, maxRange: 1e6, roundLifetime: 'data',
    tracerLength: 'data',
  });
  const records = [];
  guns.onImpact = record => records.push(record);
  guns.setFiring(group, true);
  guns.advance(1 / 60);
  guns.setFiring(group, false);
  const shot = guns.projectiles[0];
  const start = shot.mesh.position.clone();
  for (let i = 0; i < 600 && guns.projectiles.includes(shot); i++) guns.advance(1 / 60);
  const burst = records.find(r => r.kind === 'endOfLife') ?? null;
  return {
    gone: !guns.projectiles.includes(shot),
    burst: !!burst,
    records: records.length,
    at: burst ? round3(new THREE.Vector3(...burst.point).distanceTo(start)) : null,
  };
}

out.expiry = {};
for (const name of Object.keys(EXPIRING)) {
  out.expiry[name] = [0, 0.5, 0.999].map(roll => expire(name, roll));
}

// --- bullets: the tracer path falls by its own data -------------------------

/**
 * Two rounds of `name` out of a level barrel 300 m up, the second of them a
 * tracer when the gun has one, flown `seconds`: how far each has dropped.
 */
function drop(name, seconds = 0.5, frame = 1 / 60) {
  const round = BULLETS[name];
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera(),
                             viewportHeight: () => 900 });
  guns.rand = () => 0.5;
  guns.collider = world();
  if (round.table) guns.projectileMaterials = round.table;
  const node = new THREE.Group();
  node.name = `${name}Gun`;
  node.userData.fireArms = {
    projectile: round.projectile, tracer: round.tracer ?? null,
    roundOfFire: 10, magSize: 100, velocity: round.velocity,
    input: 'c_PIFire', control: 'vehicle', muzzles: 1,
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = `${node.name} muzzle 1`;
  muzzle.userData.muzzle = { index: 0 };
  node.add(muzzle);
  const root = new THREE.Group();
  root.add(node);
  root.position.set(WORLD / 2, 300, -64);
  root.updateMatrixWorld(true);
  const [group] = guns.collect(root, {
    replace: true, speedScale: 1, maxRange: 1e6, roundLifetime: 'data',
    tracerLength: 'data',
  });
  fireBarrel(guns, group, group.muzzles[0]);
  fireBarrel(guns, group, group.muzzles[0]);
  const rounds = guns.tracers.slice();
  const lead = rounds.map(r => r.lead);
  // The round itself, `lead` ahead of the drawn mesh's origin along its flight.
  const head = r => r.mesh.position.y + r.velocity.y / r.velocity.length() * r.lead;
  const start = rounds.map(head);
  for (let t = 0; t < seconds - 1e-9; t += frame) guns.advance(frame);
  return rounds.map((r, k) => ({
    bright: r.bright,
    gravity: r.gravity,
    flying: guns.tracers.includes(r),
    drop: round3(start[k] - head(r)),
    lead: lead[k],
    // The streak turns with its path: the angle of its axis below level.
    pitchDown: round3(Math.asin(Math.min(1, Math.max(-1,
      -new THREE.Vector3(0, 0, 1).applyQuaternion(r.mesh.quaternion).y)))
      * 180 / Math.PI),
  }));
}

out.bullets = {};
for (const name of Object.keys(BULLETS)) out.bullets[name] = drop(name);
// A FireArms that declares no `velocity` (DC's BRDM2 Spandrel, every
// Binoculars) launches at the constructor's 200 m/s (FA-3); 0 stays 0.
out.velocityDefault = {
  absent: releaseSpeed({}), zero: releaseSpeed({ velocity: 0 }),
  declared: releaseSpeed({ velocity: 45 }),
};
// Semi-implicit Euler at 60 Hz, as the loop runs it: v += g dt, x += v dt.
out.bullets.expectedDropAtG1 = round3(
  -GRAVITY * (1 / 60) ** 2 * (30 * 31) / 2);

// --- the CBU-87: fourteen submunitions per pull, in the authored spread -------

/** desertcombat A10_C.glb `A10_CBU87`: the dispenser node (pitched 20 deg
 *  down), and its fourteen `addFireArmsPosition 0/0/0 <yaw>/<pitch>/0` barrels
 *  as `quat_from_ypr` bakes them. */
export const CBU = {
  node: { translation: [0, -1.7, -0.6], rotation: [-0.17364817766693033, 0, 0, 0.984807753012208] },
  muzzles: [
    [-0.016741, 0.039777, 0.000667, 0.999068], [0.054384, -0.039724, 0.002165, 0.997727],
    [-0.068033, -0.098048, -0.006719, 0.992831], [-0.158461, 0.022745, 0.003651, 0.987097],
    [-0.041304, 0.164559, 0.006897, 0.985478], [0.149617, 0.088917, -0.013511, 0.984645],
    [0.057963, -0.1479, 0.008683, 0.987264], [0.008376, -0.019895, 0.000167, 0.999767],
    [-0.027218, 0.019888, 0.000542, 0.999432], [0.03416, 0.04917, -0.001683, 0.998205],
    [0.079498, -0.011482, 0.000916, 0.996768], [0.020871, -0.082616, 0.001731, 0.996361],
    [-0.07525, -0.044886, -0.003391, 0.996148], [-0.029236, 0.074251, 0.002178, 0.996809],
  ],
};

{
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera(),
                             viewportHeight: () => 900 });
  guns.rand = () => 0.5;
  guns.collider = world();
  const platform = new THREE.Vector3(0, 0, -100);
  const rack = new THREE.Group();
  rack.name = 'A10_CBU87';
  rack.position.set(...CBU.node.translation);
  rack.quaternion.set(...CBU.node.rotation);
  rack.userData.fireArms = {
    projectile: BULLETS.CBU87Prj.projectile, roundOfFire: 2, magSize: 112,
    numOfMag: 2, reloadTime: 2.5, autoReload: true, velocity: 15,
    input: 'c_PIAltFire', control: 'A10_C', muzzles: 14,
  };
  CBU.muzzles.forEach((q, k) => {
    const muzzle = new THREE.Object3D();
    muzzle.name = `A10_CBU87 muzzle ${k + 1}`;
    muzzle.userData.muzzle = { index: k };
    muzzle.quaternion.set(...q);
    rack.add(muzzle);
  });
  const plane = new THREE.Group();
  plane.name = 'A10_C';
  plane.add(rack);
  plane.position.set(WORLD / 2, 150, -64);
  plane.updateMatrixWorld(true);
  const [group] = guns.collect(plane, {
    replace: true, speedScale: 1, maxRange: 1e6, roundLifetime: 'data',
    tracerLength: 'data', platformVelocity: () => platform,
  });
  const landed = [];
  guns.onImpact = record => { if (record.kind === 'terrain') landed.push(record.point); };
  // One pull: every barrel, one projectile each (BOMB-1, BOMB-2).
  for (const muzzle of group.muzzles) fireBarrel(guns, group, muzzle);
  // The prediction from the same numbers: each round leaves its barrel's
  // forward at 15 m/s on top of the jet's 100 m/s and falls at 1.0, stepped
  // the way the loop steps it (v += g dt, x += v dt).
  const predicted = guns.tracers.map(t => {
    const p = t.mesh.position.clone().addScaledVector(t.velocity.clone().normalize(), t.lead);
    const v = t.velocity.clone();
    while (p.y > 0) { v.y += GRAVITY / 60; p.addScaledVector(v, 1 / 60); }
    return p;
  });
  const fired = guns.tracers.length;
  for (let i = 0; i < 600 && guns.tracers.length; i++) guns.advance(1 / 60);
  const xs = landed.map(p => p[0]), zs = landed.map(p => p[2]);
  // Each landing against its nearest prediction.
  const misses = landed.map(p => Math.min(...predicted.map(
    q => Math.hypot(p[0] - q.x, p[2] - q.z))));
  out.cbu = {
    fired, landed: landed.length,
    across: round3(Math.max(...xs) - Math.min(...xs)),
    along: round3(Math.max(...zs) - Math.min(...zs)),
    worstMiss: round3(Math.max(...misses)),
    // How far ahead of the release point the pattern's middle lands.
    throw: round3(-((Math.max(...zs) + Math.min(...zs)) / 2 - (-64))),
  };
}

// --- the deviation cone: a square of hundredths of a radian (DEV-9) -----------

/** `n` rounds out of a level barrel with a cone of `total`, on the muzzle path
 *  or the camera (`aimRay`) path: the spread they paint, in degrees. */
function spread(total, { ray = false, n = 4000 } = {}) {
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera(),
                             viewportHeight: () => 900 });
  let seed = 12345;
  guns.rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const node = new THREE.Group();
  node.name = 'SpreadGun';
  node.userData.fireArms = {
    projectile: BULLETS.barProjectile.projectile, roundOfFire: 10, magSize: -1,
    velocity: 1000, input: 'c_PIFire', control: 'vehicle', muzzles: 1,
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'SpreadGun muzzle 1';
  muzzle.userData.muzzle = { index: 0 };
  node.add(muzzle);
  const root = new THREE.Group();
  root.add(node);
  root.updateMatrixWorld(true);
  const aimRay = ray
    ? () => ({ origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 } })
    : null;
  const [group] = guns.collect(root, {
    replace: true, speedScale: 1, maxRange: 1e6, roundLifetime: 'data',
    tracerLength: 'data', spreadDeg: () => total, aimRay,
  });
  const yaw = [], pitch = [], radial = [], speed = [];
  for (let i = 0; i < n; i++) {
    fireBarrel(guns, group, group.muzzles[0]);
    const v = guns.tracers[guns.tracers.length - 1].velocity;
    const fwd = -v.z;
    yaw.push(Math.atan(v.x / fwd) * 180 / Math.PI);
    pitch.push(Math.atan(v.y / fwd) * 180 / Math.PI);
    radial.push(Math.atan(Math.hypot(v.x, v.y) / fwd) * 180 / Math.PI);
    speed.push(v.length());
  }
  const maxAbs = a => Math.max(...a.map(Math.abs));
  const rms = a => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
  const reachX = maxAbs(yaw), reachY = maxAbs(pitch);
  // The corners of the square: both axes past 80% of their reach at once.
  // A disc of the same per-axis reach has none (0.8 * sqrt(2) > 1).
  const corners = yaw.filter((x, k) => Math.abs(x) > 0.8 * reachX
                                       && Math.abs(pitch[k]) > 0.8 * reachY).length;
  return {
    total, ray,
    reachYaw: round3(reachX), reachPitch: round3(reachY),
    reachRadial: round3(Math.max(...radial)),
    rmsYaw: round3(rms(yaw)), rmsPitch: round3(rms(pitch)),
    cornerShare: round3(corners / n),
    maxSpeed: round3(Math.max(...speed)),
  };
}

out.spread = {
  one: spread(1),
  three: spread(3),
  threeCamera: spread(3, { ray: true }),
  // The floor: a total at or under 0.01 draws nothing.
  floor: spread(0.01, { n: 50 }),
};

function round3(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
}

console.log(JSON.stringify(out));
