// Drops real bombs and runs a real torpedo, under node, through the real
// `viewer/gunfire.js`.
//
// Every rig here is stamped the way `bf42/assemble.py` stamps one -- the numbers
// are the shipped `Stuka.glb`, `B17.glb` and `Aichival-T.glb` firing blocks, not
// invented ones -- so what the harness measures is what the page does.
//
// The questions, in the order `features/plane-bombs-and-torpedoes/README.md`
// asks them:
//
//   G-1  does a bomb rack get a firing group at all
//   G-2  does a released bomb leave at the aircraft's velocity, not 100 m/s
//   G-6  does the B17 lay a stick rather than salvo a pair
//   BOMB-1 does one pull spend one round PER PROJECTILE
//   BOMB-5 does a dive bomber on its last round drop one bomb, not two
//   G-3  does a torpedo enter the water instead of bursting on it
//   G-4  does it then float, level out and run

import * as THREE from 'three';
import { GunFire } from './gunfire.js';
import { WorldCollider } from './world-collider.js';
import { buildHeightfield } from './heightfield.js';
import { FireState } from './seats.js';
import { salvo } from './bomb-release.js';
import { TorpedoRun, runParts } from './torpedo-run.js';

const out = {};

// --- the rigs ---------------------------------------------------------------

/** A drawn projectile body, tagged the way the exporter tags one. `length` is
 *  the mesh's own, so the drag term's bounding radius is a real measurement. */
function body(name, length, width) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, width, length),
    new THREE.MeshBasicMaterial());
  mesh.name = `${name} projectile`;
  mesh.userData.projectileMesh = { template: name };
  return mesh;
}

/**
 * One FireArms node with `n` `addFireArmsPosition` barrels.
 *
 * `positions` are the real ones: a Stuka's +-3.3 on the wings, a B17's
 * -1/-0.1/0 and 1/0.1/0.
 */
function rack(name, stats, positions, projectileBody) {
  const node = new THREE.Group();
  node.name = name;
  node.userData.fireArms = stats;
  for (const [i, p] of positions.entries()) {
    const muzzle = new THREE.Object3D();
    muzzle.name = `${name} muzzle ${i + 1}`;
    muzzle.userData.muzzle = { index: i };
    muzzle.position.set(p[0], p[1], p[2]);
    node.add(muzzle);
  }
  node.add(projectileBody);
  const plane = new THREE.Group();
  plane.name = 'Plane';
  plane.add(node);
  return plane;
}

/** `Objects/Vehicles/Common/Weapons.con`, `create Projectile DiveBomberBomb`. */
const DIVE_BOMB = {
  template: 'DiveBomberBomb', kind: 'shell', trail: null,
  timeToLive: 20.0, material: 242, mass: 250.0, drag: 0.08,
  hasPointPhysics: false, stopAtEndEffect: true,
  damage: { radius: 20.0, material2: 202, damageType: 1,
            hasCollisionEffect: true, dieAfterColl: false,
            yModOnExplosion: 2.0 },
};

/** `create Projectile AircraftTorpedo`, with the five physics children that
 *  reach the viewer for the first time this round. */
const TORPEDO = {
  template: 'AircraftTorpedo', kind: 'shell', trail: null,
  timeToLive: 20.0, gravity: 1.0, material: 250,
  mass: 800.0, drag: 0.04, hasPointPhysics: false,
  damage: { radius: 30.0, hasCollisionEffect: true,
            detonateOnWaterCollision: false },
  trailBundle: 'e_WaterTorpedo',
  endEffect: 'WaterExplosionTorpedo',
  parts: [
    { template: 'Torpedo_Floater', kind: 'FloatingBundle',
      position: [0, 3, 2], rotation: [0, 0, 0],
      hullHeight: 4.3, floatMaxLift: 5.9, floatMinLift: 5.9,
      dragModifier: 8000.0 },
    { template: 'Torpedo_Floater', kind: 'FloatingBundle',
      position: [0, 3, -2], rotation: [0, 0, 0],
      hullHeight: 4.3, floatMaxLift: 5.9, floatMinLift: 5.9,
      dragModifier: 8000.0 },
    { template: 'Torpedo_Engine', kind: 'Engine', position: [0, 0, 3],
      rotation: [0, 0, 0], engineType: 'c_ETTorpedo', torque: 12.5,
      differential: 5.0, noPropellerEffectAtSpeed: 120.0,
      maxRotation: [0, 0, 5000], maxSpeed: [0, 0, 10000],
      acceleration: [0, 0, 10000] },
    { template: 'Torpedo_Wing', kind: 'Wing', position: [0, 0, 3],
      rotation: [0, 0, 0], wingLift: 0.2 },
    { template: 'Torpedo_Wing', kind: 'Wing', position: [0, 0, 3],
      rotation: [0, 0, -90], wingLift: 0.2 },
  ],
};

const STUKA_RACK = {
  projectile: DIVE_BOMB, roundOfFire: 0.2, magSize: 30, numOfMag: 1,
  velocity: 0.0, input: 'c_PIAltFire', control: 'Stuka', muzzles: 2,
  projectilePosition: [0, -0.4, 0.2],
};

const B17_RACK = {
  projectile: { ...DIVE_BOMB, template: 'HeavyBomberBomb' },
  roundOfFire: 4, magSize: 8, numOfMag: 10, reloadTime: 15.0,
  autoReload: true, asynchronyFire: true, velocity: 0.0,
  input: 'c_PIAltFire', control: 'B17', muzzles: 2,
};

const TORPEDO_RACK = {
  projectile: TORPEDO, roundOfFire: 0.1, magSize: 15, numOfMag: 1,
  reloadTime: 10.0, autoReload: true, velocity: 0.0,
  input: 'c_PIAltFire', control: 'Aichival-T', muzzles: 1,
};

// --- a world ----------------------------------------------------------------

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The four fields of a three.js Mesh `collision.js` reads, the same stand-in
 *  `collision_harness.mjs` uses. */
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

/**
 * A world big enough for a bomb released at 150 m/s from 500 m to land in it.
 *
 * The heightfield is REAL -- built by `collision.js`'s own `buildHeightfield`,
 * because `WorldCollider.cast` marches the lattice and a `{height: () => 0}`
 * stub is not something it can march. A drop is 1.2 km of throw, so the tile is
 * 2,048 m square.
 */
function world({ ground = 0, waterLevel = null, size = 2048 } = {}) {
  const field = buildHeightfield([flatTile(size, ground, size / 8)],
                                 { worldSize: size, dim: 8 });
  return new WorldCollider({ heightfield: field, waterLevel });
}

/**
 * A `GunFire` with the ammo hooks the page wires, so the salvo and the charge
 * are the ones a seated player gets.
 */
function armed(scene, { collider = null, platform = null } = {}) {
  const camera = new THREE.PerspectiveCamera();
  const guns = new GunFire({ scene, camera, viewportHeight: () => 900 });
  guns.rand = () => 0.5;
  guns.collider = collider;
  const states = new Map();
  guns.roundsLeft = group => {
    const state = states.get(group.node);
    return state && !state.unlimited ? state.ammo : Infinity;
  };
  guns.onShot = (group, rounds) => states.get(group.node)?.registerShot(rounds);
  return {
    guns, states,
    collect(root) {
      const found = guns.collect(root, {
        replace: true, speedScale: 1, maxRange: 4000, roundLifetime: 'data',
        tracerLength: 'data',
        platformVelocity: platform ? () => platform : null,
      });
      for (const group of found) {
        states.set(group.node, new FireState(group.stats));
      }
      return found;
    },
  };
}

// --- G-1: the group exists --------------------------------------------------

{
  const scene = new THREE.Scene();
  const rig = rack('StukaBombRack', STUKA_RACK,
                   [[3.3, -0.199, 0], [-3.3, -0.199, 0]],
                   body('DiveBomberBomb', 1.8, 0.4));
  const { collect } = armed(scene);
  const found = collect(rig);
  out.g1 = {
    groups: found.length,
    name: found[0]?.node.name ?? null,
    muzzles: found[0]?.muzzles.length ?? 0,
    // The drag law's frontal area: measured off the body's own geometry.
    boundingRadius: found[0]?.boundingRadius ?? null,
  };
  // And the guard still keeps out a placeholder with no signature and nothing
  // to launch, which is what it was there for.
  const inert = rack('PlaneDummy',
                     { projectile: { template: 'X', kind: 'bullet' },
                       roundOfFire: 1, velocity: 0, muzzles: 1 },
                     [[0, 0, 0]], new THREE.Object3D());
  out.g1.inertGroups = armed(new THREE.Scene()).collect(inert).length;
}

// --- G-2 and BOMB-1: the release, and what it costs -------------------------

{
  const scene = new THREE.Scene();
  // 80 m/s down -Z: a Stuka in a shallow dive at a plausible release speed.
  const platform = new THREE.Vector3(0, -10, -80);
  const rig = rack('StukaBombRack', STUKA_RACK,
                   [[3.3, -0.199, 0], [-3.3, -0.199, 0]],
                   body('DiveBomberBomb', 1.8, 0.4));
  rig.position.set(0, 500, 0);
  rig.updateMatrixWorld(true);
  const { guns, states, collect } = armed(scene, { platform });
  const [group] = collect(rig);
  const state = states.get(group.node);
  out.g2 = { ammoBefore: state.ammo };
  guns.setFiring(group, true);
  guns.advance(1 / 60);
  guns.setFiring(group, false);
  out.g2.released = guns.projectiles.length;
  out.g2.ammoAfter = state.ammo;
  out.g2.speeds = guns.projectiles.map(p => round3(p.velocity.length()));
  out.g2.velocity = guns.projectiles.map(
    p => [round3(p.velocity.x), round3(p.velocity.y), round3(p.velocity.z)]);
  // Where each bomb appeared, against the two barrels at +-3.3.
  out.g2.dropPoints = guns.projectiles
    .map(p => [round3(p.mesh.position.x), round3(p.mesh.position.z)])
    .sort((a, b) => a[0] - b[0]);
  out.g2.gravityScale = guns.projectiles.map(p => p.gravityScale);
}

// --- BOMB-1 over a whole magazine, and BOMB-5's partial salvo ---------------

{
  const scene = new THREE.Scene();
  const rig = rack('StukaBombRack', STUKA_RACK,
                   [[3.3, -0.199, 0], [-3.3, -0.199, 0]],
                   body('DiveBomberBomb', 1.8, 0.4));
  const { guns, states, collect } = armed(scene);
  const [group] = collect(rig);
  const state = states.get(group.node);
  const trace = [];
  let pulls = 0;
  while (state.ammo > 0 && pulls < 40) {
    const before = guns.projectiles.length;
    group.cooldown = 0;
    guns.setFiring(group, true);
    guns.advance(1 / 600);
    guns.setFiring(group, false);
    pulls++;
    trace.push({ released: guns.projectiles.length - before, left: state.ammo });
  }
  out.magazine = { pulls, bombs: guns.projectiles.length, trace };

  // The last round on its own: `salvo` is the arithmetic, checked directly so
  // the rule is pinned even where the rig cannot reach it.
  out.partial = {
    full: salvo(2, { roundsLeft: 30 }),
    last: salvo(2, { roundsLeft: 1 }),
    unlimited: salvo(2, { roundsLeft: Infinity }),
    async2of8: salvo(2, { asynchronyFire: true, roundsLeft: 8, nextBarrel: 0 }),
    async2of8Next: salvo(2, { asynchronyFire: true, roundsLeft: 7, nextBarrel: 1 }),
    single: salvo(1, { roundsLeft: 15 }),
  };
}

// --- G-6: the B17 lays a stick ---------------------------------------------

{
  const scene = new THREE.Scene();
  const rig = rack('B17BombRack', B17_RACK,
                   [[-1, -0.1, 0], [1, 0.1, 0]],
                   body('HeavyBomberBomb', 1.8, 0.4));
  rig.position.set(0, 800, 0);
  rig.updateMatrixWorld(true);
  const platform = new THREE.Vector3(0, 0, -60);
  const { guns, states, collect } = armed(scene, { platform });
  const [group] = collect(rig);
  const state = states.get(group.node);
  // Hold the trigger for the whole magazine at `roundOfFire 4`: 8 bombs at
  // 0.25 s apart is a 2 s stick.
  const xs = [];
  const times = [];
  let t = 0;
  guns.setFiring(group, true);
  for (let i = 0; i < 180 && state.ammo > 0; i++) {
    const before = guns.projectiles.length;
    guns.advance(1 / 60);
    t += 1 / 60;
    if (guns.projectiles.length > before) {
      for (let k = before; k < guns.projectiles.length; k++) {
        xs.push(round3(guns.projectiles[k].mesh.position.x));
        times.push(round3(t));
      }
    }
  }
  guns.setFiring(group, false);
  out.stick = {
    bombs: guns.projectiles.length,
    ammo: state.ammo,
    reloading: round3(state.reloadRemaining),
    // Alternating barrels: -1 then +1 then -1 ... in the rig's own x.
    barrelX: xs,
    releaseTimes: times,
    // Along-track spacing at 60 m/s and 4 rounds a second.
    spacingMetres: times.length > 1
      ? round3((times[times.length - 1] - times[0]) / (times.length - 1) * 60)
      : null,
  };
}

// --- the fall: a bomb from 500 m -------------------------------------------

/**
 * One bomb released level at 150 m/s from `height`, flown to the ground.
 *
 * The aircraft sits at x = 1024, the middle of the 2,048 m tile, so BOTH wing
 * barrels are over the heightfield -- off its edge `field.height` is NaN, the
 * cast finds no terrain and the bomb flies to the range cap instead of landing.
 */
function drop({ drag = true, height = 500, speed = 150 } = {}) {
  const scene = new THREE.Scene();
  const collider = world({ ground: 0 });
  const platform = new THREE.Vector3(0, 0, -speed);
  const projectile = drag ? DIVE_BOMB
    : { ...DIVE_BOMB, mass: undefined, drag: undefined };
  const rig = rack('StukaBombRack', { ...STUKA_RACK, projectile },
                   [[3.3, -0.199, 0], [-3.3, -0.199, 0]],
                   body('DiveBomberBomb', 1.8, 0.4));
  rig.position.set(1024, height, 0);
  rig.updateMatrixWorld(true);
  const { guns, collect } = armed(scene, { collider, platform });
  const [group] = collect(rig);
  const impacts = [];
  let t = 0;
  guns.onImpact = record => impacts.push({ record, at: round3(t) });
  guns.setFiring(group, true);
  guns.advance(1 / 60);
  guns.setFiring(group, false);
  const start = guns.projectiles[0].mesh.position.clone();
  for (let i = 0; i < 4000 && guns.projectiles.length; i++) {
    guns.advance(1 / 60);
    t += 1 / 60;
  }
  const first = impacts[0] || null;
  const hit = first?.record ?? null;
  return {
    seconds: first?.at ?? null,
    impacts: impacts.length,
    kind: hit?.kind ?? null,
    material: hit?.material ?? null,
    // The impact explosion: `damageType 1` AND `hasCollisionEffect`, so the
    // splash pass is the IMPACT one -- radius 20, material2 202, yMod 2.
    blast: hit?.blast ?? null,
    splashRadius: hit?.splashRadius ?? null,
    splashMaterial2: hit?.splashMaterial2 ?? null,
    splashYMod: hit?.splashYMod ?? null,
    from: [round3(start.x), round3(start.y), round3(start.z)],
    to: hit ? hit.point.map(round3) : null,
    // Where the record says the bomb left: `Projectile+0x134`, the `Pos3` a
    // direct hit hands `giveDamage` (ledger HFD-4).
    origin: hit?.origin ? hit.origin.map(round3) : null,
    // Range along track, which is the number a pilot aims with.
    throwMetres: hit ? round3(Math.abs(hit.point[2] - start.z)) : null,
    impactSpeed: hit ? round3(Math.hypot(...(hit.normal || [0, 0, 0]))) : null,
  };
}

out.fall = drop();
// The same fall with the drag term switched off, so the size of the correction
// is measured rather than asserted.
out.fallNoDrag = drop({ drag: false });

// --- G-3: a bomb bursts on the sea, a torpedo goes through it ---------------

{
  // The bomb first: it declares no `detonateOnWaterCollision`, so absent must
  // keep meaning "behave as this viewer always has".
  const scene = new THREE.Scene();
  const collider = new WorldCollider({ waterLevel: 0 });
  const rig = rack('StukaBombRack', STUKA_RACK,
                   [[3.3, -0.199, 0], [-3.3, -0.199, 0]],
                   body('DiveBomberBomb', 1.8, 0.4));
  rig.position.set(0, 120, 0);
  rig.updateMatrixWorld(true);
  const { guns, collect } = armed(scene, { collider });
  const [group] = collect(rig);
  const impacts = [];
  guns.onImpact = record => impacts.push(record);
  guns.setFiring(group, true);
  guns.advance(1 / 60);
  guns.setFiring(group, false);
  for (let i = 0; i < 600 && guns.projectiles.length; i++) guns.advance(1 / 60);
  out.bombOnWater = {
    impacts: impacts.length,
    kind: impacts[0]?.kind ?? null,
    material: impacts[0]?.material ?? null,
    y: impacts[0] ? round3(impacts[0].point[1]) : null,
    inFlight: guns.projectiles.length,
  };
}

/**
 * One torpedo released at `height` with a `sink` rate, run to its `timeToLive`.
 *
 * Two altitudes are measured, because the answer depends on how much downward
 * velocity the torpedo carries under: the doctrinal low, slow release a torpedo
 * bomber actually flies, and a careless high one.
 */
function torpedoRun({ height = 20, sink = -2, speed = 70 } = {}) {
  const scene = new THREE.Scene();
  const collider = new WorldCollider({ waterLevel: 0 });
  const platform = new THREE.Vector3(0, sink, -speed);
  const rig = rack('Aichival-TBombRack', TORPEDO_RACK, [[0, -1, 0]],
                   body('AircraftTorpedo', 2.5, 0.5));
  rig.position.set(0, height, 0);
  rig.updateMatrixWorld(true);
  const { guns, collect } = armed(scene, { collider, platform });
  const [group] = collect(rig);
  const impacts = [];
  guns.onImpact = record => impacts.push(record);
  guns.setFiring(group, true);
  guns.advance(1 / 60);
  guns.setFiring(group, false);
  const shot = guns.projectiles[0];
  const start = shot.mesh.position.clone();
  const samples = [];
  let t = 0;
  let entered = null;
  let deepest = 0;
  for (let i = 0; i < 1800 && guns.projectiles.length; i++) {
    guns.advance(1 / 60);
    t += 1 / 60;
    if (entered === null && shot.torpedo) entered = round3(t);
    if (shot.torpedo) deepest = Math.max(deepest, shot.torpedo.depth);
    if (i % 60 === 0 && guns.projectiles.length) {
      samples.push({
        t: round3(t),
        depth: shot.torpedo ? round3(shot.torpedo.depth) : null,
        speed: round3(shot.velocity.length()),
        running: shot.torpedo ? shot.torpedo.running : null,
      });
    }
  }
  return {
    enteredAt: entered,
    impacts: impacts.length,
    samples,
    deepest: round3(deepest),
    finalDepth: shot.torpedo ? round3(shot.torpedo.depth) : null,
    finalSpeed: round3(shot.velocity.length()),
    ranMetres: round3(Math.hypot(shot.mesh.position.x - start.x,
                                 shot.mesh.position.z - start.z)),
    seconds: round3(t),
    // No guidance: the heading it entered on is the heading it keeps.
    driftX: round3(shot.mesh.position.x - start.x),
  };
}

out.torpedo = torpedoRun();
out.torpedoHigh = torpedoRun({ height: 40, sink: -6 });
out.torpedo.parts = runParts(TORPEDO);
{
  // The equilibrium depth, solved directly off the parts rather than watched.
  const run = new TorpedoRun(TORPEDO, 0, 1.27);
  const probe = [];
  for (let d = 0; d <= 12; d += 1) probe.push([d, round3(run.buoyancy(d))]);
  out.torpedo.buoyancyByDepth = probe;
}

function round3(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
}

console.log(JSON.stringify(out));
