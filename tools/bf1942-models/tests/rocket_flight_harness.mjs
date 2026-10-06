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
//   motor    what the motor does on its own: the speed it settles at, flat

import * as THREE from 'three';
import { GunFire } from './gunfire.js';
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

/** A launcher with one barrel, pitched `degrees` up, firing `name`'s round. */
function launcher(name, degrees) {
  const round = ROUNDS[name];
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
  root.position.set(WORLD / 2, 2, -64);
  root.updateMatrixWorld(true);
  return root;
}

/** One round, fired and flown until it lands or its fuse ends. */
function fly(name, degrees, { frame = 1 / 60 } = {}) {
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera(),
                             viewportHeight: () => 900 });
  guns.rand = () => 0.5;
  guns.collider = world();
  const [group] = guns.collect(launcher(name, degrees), {
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
    for (const mark of [1, 2, 5, 10]) {
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

function round3(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
}

console.log(JSON.stringify(out));
