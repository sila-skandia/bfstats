// Drives `viewer/gunfire.js` under node and asks one question of every spawn:
// is the thing it put in the world scene visible to a world camera?
//
// A first-person hand weapon's rig lives wholesale on map.html's
// VIEWMODEL_LAYER so the near pass can draw it over cleared depth, and
// `Object3D.clone()` copies `layers`. So a grenade cloned out of that rig and
// parented into the world scene used to be drawn by nobody — the world camera's
// mask does not include layer 1, and the near camera only renders `vmScene`.
// That is the invisible thrown grenade, and it would equally have hidden a
// bazooka's rocket body.
//
// The rig here is the real shape: a FireArms node stamped the way the extractor
// stamps one, with a `projectileMesh` and a `tracerMesh` child, every node moved
// to layer 1 before `collect` sees it — exactly map.html's order.

import * as THREE from 'three';
import { GunFire } from './gunfire.js';

const VIEWMODEL_LAYER = 1;

function grenadeRig() {
  const arms = new THREE.Group();
  arms.name = 'USSoldier GrenadeAllies viewmodel';
  const weapon = new THREE.Group();
  weapon.name = 'GrenadeAllies';
  weapon.userData.fireArms = {
    roundOfFire: 1, fireOnce: true, velocity: 25, muzzles: 1,
    magSize: 3, numOfMag: 1,
    projectile: {
      kind: 'shell', template: 'GrenadeAlliesProjectile', timeToLive: 3.0,
      gravity: 1, material: 70,
      // `isFuseRound`: an end-of-life blast, no collision effect, survives
      // contact — the three conditions both grenades meet.
      damage: { hasCollisionEffect: false, dieAfterColl: false,
                explosionDamage: 0 },
    },
    throw: { fireDelay: 1, hideDuringFireTime: 0.4, rotationalSpeed: [8, 0, 0] },
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.userData.muzzle = true;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.12),
                              new THREE.MeshBasicMaterial());
  body.name = 'GrenadeAllies projectile';
  body.userData.projectileMesh = true;
  // A nested child, so the fix has to reach descendants and not just the root.
  const pin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.03),
                             new THREE.MeshBasicMaterial());
  pin.name = 'GrenadeAllies pigg';
  body.add(pin);
  const streak = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 1),
                                new THREE.MeshBasicMaterial());
  streak.name = 'TLight';
  streak.userData.tracerMesh = true;
  weapon.add(muzzle, body, streak);
  arms.add(weapon);
  // map.html's own line, and the reason for this harness.
  arms.traverse(obj => obj.layers.set(VIEWMODEL_LAYER));
  return { arms, weapon, body, streak };
}

/** Every mesh under `root` a camera on `layer` would actually draw. */
function drawable(root, layer) {
  const camera = new THREE.PerspectiveCamera();
  camera.layers.set(layer);
  const seen = [];
  root.traverse(obj => {
    if (obj.isMesh && camera.layers.test(obj.layers)) seen.push(obj.name);
  });
  return seen;
}

const out = {};
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
// `viewportHeight` defaults to `window.innerHeight`, which node has not got.
const guns = new GunFire({ scene, camera, viewportHeight: () => 900 });
guns.rand = () => 0.5;
const { arms, weapon } = grenadeRig();
const found = guns.collect(arms, {
  replace: true,
  speedScale: 1,
  roundLifetime: 'data',
  aimRay: () => ({ origin: { x: 0, y: 2, z: 0 }, dir: { x: 0, y: 0.2, z: -1 } }),
});
out.collected = found.length;
out.foundProjectileMesh = !!found[0]?.projectileMesh;
// The template itself stays where map.html put it: it is part of the arms rig
// and the near pass is what draws the rig. 1 << 1 = 2.
out.templateLayerMask = found[0]?.projectileMesh?.layers.mask ?? null;

guns.setFiring(found[0], true);
guns.advance(1 / 30);
out.projectilesInFlight = guns.projectiles.length;
const round = guns.projectiles[0];
out.roundName = round?.mesh?.name ?? null;
out.roundParentIsScene = round?.mesh?.parent === scene;
// The question this harness exists to ask.
out.worldCameraSees = round ? drawable(round.mesh, 0) : [];
out.nearCameraSees = round ? drawable(round.mesh, VIEWMODEL_LAYER) : [];
out.spin = round?.spin ?? null;

// And the arms rig is untouched: a shot must not drag the viewmodel onto the
// world layer along with the round it fired.
out.rigStillOnViewmodelLayer = drawable(arms, VIEWMODEL_LAYER).length;
out.rigOnWorldLayer = drawable(arms, 0).length;
out.weaponChildCount = weapon.children.length;

// A pooled round is re-adopted rather than trusted: end this one, then fire
// again and check the recycled mesh is still world-visible.
round.age = 99;
round.ttl = 0.01;
guns.advance(1 / 30);
out.pooledAfterExpiry = found[0].projectilePool.length;
guns.setFiring(found[0], false);
found[0].cooldown = 0;
guns.setFiring(found[0], true);
guns.advance(1 / 30);
const again = guns.projectiles[0];
out.secondRound = !!again;
out.secondRoundWorldCameraSees = again ? drawable(again.mesh, 0) : [];

// --- whose flash: the observer's view is his own guns' alone ---------------
// `guns.firstPerson` is set every frame the human is on foot, and used to
// pick the flash for every gun on the page: a bot's rifle or a bot-crewed
// hull's coax got the 0.4 m `em_1P_*` sprite made for the seat's own eye.
// `flash` lights a muzzle with no round (a bot's rifle round is the
// referee's ray), and `group.view` / `guns.viewOf` pin the outside flash.
{
  const rifle = new THREE.Group();
  rifle.name = 'K98';
  rifle.userData.fireArms = { roundOfFire: 1, velocity: 800, muzzles: 1,
                              projectile: { kind: 'bullet', damage: {} } };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'K98 muzzle';
  muzzle.userData.muzzle = true;
  rifle.add(muzzle);
  const flashFor = view => {
    const node = new THREE.Object3D();
    node.name = `flash ${view}`;
    node.userData.effect = { kind: 'sprite', view, timeToLive: 0.1 };
    muzzle.add(node);
    return node;
  };
  flashFor('first');
  flashFor('third');
  const shots = [];
  guns.onShot = group => shots.push(group);
  const [group] = guns.collect(rifle, { replace: false });
  const lit = () => group.emitters.filter(e => e.age === 0).map(e => e.spec.view).sort();
  const before = guns.tracers.length + guns.projectiles.length;
  guns.firstPerson = true;
  guns.flash(group);
  out.flashOwn = lit();
  for (const e of group.emitters) e.age = Infinity;
  group.view = 'third';
  guns.flash(group);
  out.flashPinned = lit();
  for (const e of group.emitters) e.age = Infinity;
  group.view = undefined;
  guns.viewOf = g => (g === group ? 'third' : null);
  guns.flash(group);
  out.flashViewOf = lit();
  guns.viewOf = null;
  out.flashRounds = guns.tracers.length + guns.projectiles.length - before;
  out.flashOnShot = shots.length;
}

// --- a FireArms under a FireArms is a weapon of its own ---------------------
// FHSW's `M1GarandBay`: the HandFireArms fires `7,62mmProjectile` from one
// barrel on `c_PIFire`, and its child `BayonetM1Garand` stabs with
// `Melee_Bayonet_Projectile` from five `addFireArmsPosition`s on
// `c_PIAltFire`. The node shape is the exporter's (`USSoldier__M1GarandBay
// .fp.glb`). Collected with a whole-subtree walk, the rifle owned all six
// barrels and one click emptied six of its eight rounds.
{
  const barrel = (name, index) => {
    const node = new THREE.Object3D();
    node.name = name;
    node.userData.muzzle = { index };
    return node;
  };
  const rifle = new THREE.Group();
  rifle.name = 'M1GarandBay';
  rifle.userData.fireArms = {
    roundOfFire: 6, velocity: 855, muzzles: 1, magSize: 8, input: 'c_PIFire',
    projectile: { template: '7,62mmProjectile', kind: 'bullet', timeToLive: 1.067, damage: {} },
  };
  const stab = new THREE.Group();
  stab.name = 'BayonetM1Garand';
  stab.userData.fireArms = {
    roundOfFire: 1.51, velocity: 105, muzzles: 5, magSize: -1, input: 'c_PIAltFire',
    throw: { fireDelay: 0.1 },
    projectile: { template: 'Melee_Bayonet_Projectile', kind: 'bullet', timeToLive: 0.065, damage: {} },
  };
  for (let i = 0; i < 5; i++) stab.add(barrel(`BayonetM1Garand muzzle ${i + 1}`, i));
  // The stab's own flash, were it to have one: the rifle must not light it.
  const stabFlash = new THREE.Object3D();
  stabFlash.name = 'stab flash';
  stabFlash.userData.effect = { kind: 'sprite', view: 'first' };
  stab.add(stabFlash);
  rifle.add(stab, barrel('M1GarandBay muzzle 1', 0));
  const billed = [];
  guns.onShot = (group, rounds) => billed.push([group.node.name, rounds]);
  const groups = guns.collect(rifle, { replace: true, speedScale: 1, roundLifetime: 'data' });
  // The rifle's clip of eight; the stab's `magSize -1` is unlimited.
  guns.roundsLeft = group => (group === groups[0] ? 8 : Infinity);
  const rounds = () => guns.tracers.length + guns.projectiles.length;
  out.nested = {
    groups: groups.map(g => [g.node.name, g.stats.input, g.muzzles.map(m => m.name)]),
    rifleEmitters: groups[0].emitters.length,
    stabEmitters: groups[1].emitters.length,
  };
  let before = rounds();
  guns.fireShot(groups[0]);
  out.nested.riflePull = rounds() - before;
  before = rounds();
  guns.fireShot(groups[1]);
  out.nested.stabPull = rounds() - before;
  out.nested.billed = billed;
  guns.onShot = null;
  guns.roundsLeft = null;
}

console.log(JSON.stringify(out));
