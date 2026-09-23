// A flak round against an aircraft that is moving: the cast, the proximity
// fuse, and the lifetime. `test_proximity_fuse.py` copies this beside the
// viewer modules and asserts on the JSON it prints.
//
// The aircraft is a real collision hull in a real `CollisionIndex`, baked far
// from the fight (x = 1000), and flown through the round's path by
// `setMovedOwner` every tick, exactly as `hull-bodies.js`'s
// `publishMovedHull` flies a driven hull, the human's or a bot's. The gun
// points straight up from the origin at 300 m/s.

import * as THREE from 'three';
import { GunFire } from './gunfire.js';
import { buildCollisionIndex, WorldCollider } from './collision.js';
import { fuseArmed, fuseTarget, proximityFuseOf, FUSE_MIN_SPEED_SQ }
  from './proximity-fuse.js';

const out = {};

// --- the law, alone ----------------------------------------------------------

const flak = proximityFuseOf({}, { explodeNearEnemyDistance: 10, proximityFusePrimer: 0.1 });
out.fuse = flak;
out.offWhenAbsent = proximityFuseOf({}, { material: 228 });
out.offWhenMinusOne = proximityFuseOf({}, { explodeNearEnemyDistance: -1 });
out.massFromSpec = proximityFuseOf({ mass: 130 }, { explodeNearEnemyDistance: 3 })?.mass;
out.armedAt = [0.05, 0.1, 0.11].map(age => fuseArmed(flak, age));
const at = { x: 0, y: 0, z: 0, underWater: false };
const plane = (over) => ({ x: 6, y: 0, z: 0, mass: 3000, vx: 60, vy: 0, vz: 0, ...over });
out.law = {
  movingPlane: !!fuseTarget(flak, at, [plane()]),
  parkedPlane: !!fuseTarget(flak, at, [plane({ vx: 0 })]),
  justUnderSpeed: !!fuseTarget(flak, at, [plane({ vx: Math.sqrt(FUSE_MIN_SPEED_SQ) - 0.01 })]),
  atSpeed: !!fuseTarget(flak, at, [plane({ vx: Math.sqrt(FUSE_MIN_SPEED_SQ) })]),
  outside: !!fuseTarget(flak, at, [plane({ x: 10.01 })]),
  onTheEdge: !!fuseTarget(flak, at, [plane({ x: 10 })]),
  soldier: !!fuseTarget(flak, at, [plane({ soldier: true })]),
  notHeavier: !!fuseTarget(flak, at, [plane({ mass: 1 })]),
  tooHeavy: !!fuseTarget(flak, at, [plane({ mass: 100001 })]),
  // No team is consulted: a friendly aircraft sets it off the same.
  noTeamTest: !!fuseTarget(flak, at, [plane({ team: 2, firerTeam: 2 })]),
};
// Under water only the height counts, and only for something heavy.
const charge = proximityFuseOf({ mass: 800 }, { explodeNearEnemyDistance: 50 });
const wet = { x: 0, y: -20, z: 0, underWater: true };
out.underWater = {
  shipAbove: !!fuseTarget(charge, wet, [{ x: 400, y: 10, z: 0, mass: 60000 }]),
  lightBoat: !!fuseTarget(charge, wet, [{ x: 0, y: 10, z: 0, mass: 40000, vx: 20 }]),
  tooHigh: !!fuseTarget(charge, wet, [{ x: 0, y: 31, z: 0, mass: 60000 }]),
};

// --- the fight ---------------------------------------------------------------

// A plane hull: a 10 x 2 x 8 m box, as a collision mesh, baked at x = 1000.
function planeHull() {
  const hull = new THREE.Group();
  hull.name = 'Spitfire';
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 8), new THREE.MeshBasicMaterial());
  box.userData.collision = true;
  box.geometry.userData.defenseMaterial = 60;
  hull.add(box);
  hull.position.set(1000, 100, 0);
  hull.updateMatrixWorld(true);
  return hull;
}

function aaRig() {
  const weapon = new THREE.Group();
  weapon.name = 'AA_Allies_GunBarrel';
  weapon.userData.fireArms = {
    roundOfFire: 3, velocity: 300, muzzles: 1, magSize: -1, numOfMag: 999,
    projectile: {
      kind: 'shell', template: 'AA_Allies_Projectile', timeToLive: 0.8,
      gravity: 0, material: 228,
      damage: { damageType: 4, hasCollisionEffect: true, dieAfterColl: true,
                material2: 199, radius: 20 },
      endEffect: 'e_FlakBig',
    },
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.userData.muzzle = true;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6), new THREE.MeshBasicMaterial());
  body.name = 'AA projectile';
  body.userData.projectileMesh = true;
  weapon.add(muzzle, body);
  return weapon;
}

const TABLE = {
  aa_allies_projectile: { material: 228, timeToLive: ['u', 0.8, 1.4, 0],
                          explodeNearEnemyDistance: 10, proximityFusePrimer: 0.1 },
};

/**
 * One round up through a plane crossing its path at 100 m.
 *
 * `miss` is how far off the round's line the plane's origin passes, `speed`
 * its speed along +x, `fuse` whether the page hands the guns its hulls.
 * The plane is placed so its origin crosses x = 0 when the round reaches
 * y = 100 (1/3 s after the shot).
 */
function engagement({ miss = 0, speed = 60, fuse = true, rand = 0.5 } = {}) {
  const scene = new THREE.Scene();
  const hull = planeHull();
  scene.add(hull);
  const statics = buildCollisionIndex(scene, { ownerRoots: [hull] });
  const owner = statics.ownerOf(hull);
  const world = new WorldCollider({ statics });
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera(),
                             viewportHeight: () => 900 });
  guns.rand = () => rand;
  guns.collider = world;
  guns.projectileMaterials = TABLE;
  const baked = hull.matrixWorld.clone();
  const bakedInv = baked.clone().invert();
  const body = { owner, pos: [0, 0, 0], v: [speed, 0, 0], mass: 3000 };
  const place = (t) => {
    body.pos = [-speed * (1 / 3) + speed * t, 100, miss];
    // `publishMovedHull`: baked frame -> the body's pose.
    const now = new THREE.Matrix4().makeTranslation(...body.pos);
    const fwd = now.multiply(bakedInv);
    world.setMovedOwner(owner, fwd.elements, fwd.clone().invert().elements,
                        body.pos[0], body.pos[1], body.pos[2], 7);
  };
  if (fuse) {
    guns.nearObjects = (x, y, z, radius) => {
      const d = Math.hypot(body.pos[0] - x, body.pos[1] - y, body.pos[2] - z);
      return d <= radius + 7 ? [{ owner, x: body.pos[0], y: body.pos[1], z: body.pos[2],
                                   mass: body.mass, vx: body.v[0], vy: body.v[1], vz: body.v[2] }] : [];
    };
  }
  const group = guns.collect(aaRig(), {
    replace: true, speedScale: 1, roundLifetime: 'data', maxRange: 1500,
    aimRay: () => ({ origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 1, z: 0 } }),
  })[0];
  let t = 0;
  place(t);
  guns.setFiring(group, true);
  guns.advance(1 / 30);
  guns.setFiring(group, false);
  const ttl = guns.projectiles[0]?.ttl ?? null;
  const proximity = guns.projectiles[0]?.proximity ?? null;
  for (let i = 0; i < 90 && guns.projectiles.length; i++) {
    t += 1 / 30;
    place(t);
    guns.advance(1 / 30);
  }
  const hit = guns.hits[0] ?? null;
  // The hull's baked place is empty once it has flown: a round there meets nothing.
  const bakedEmpty = world.cast(1000, 0, 0, 0, 1, 0, 200, -1) === null;
  return {
    ttl, proximity: !!proximity, bakedEmpty,
    hit: hit && {
      kind: hit.kind, owner: hit.owner, fusedOn: hit.fusedOn ?? null,
      blast: hit.blast ?? null, material: hit.material,
      travelled: Math.round(hit.travelled), splashRadius: hit.splashRadius ?? null,
      point: hit.point.map(v => Math.round(v * 10) / 10),
    },
    owner,
  };
}

out.throughTheHull = engagement({ miss: 0, fuse: false });
out.passNear = engagement({ miss: 6 });
out.passFar = engagement({ miss: 14 });
out.parkedNear = engagement({ miss: 6, speed: 0 });
out.noFuseNear = engagement({ miss: 6, fuse: false });
out.ttlLow = engagement({ miss: 30, rand: 0.999999 }).ttl;
out.ttlHigh = engagement({ miss: 30, rand: 0 }).ttl;

console.log(JSON.stringify(out));
