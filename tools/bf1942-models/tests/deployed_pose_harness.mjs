// Drives viewer/deployables-page.js under node: a hand weapon's round places
// an object on a 40-degree hill, once with mobile physics (the DC mortar: it
// falls and stands on the slope's normal, the page's settle) and once with
// none (BF1918's DeployedStokes: it stands at the spawner's point, turned as
// the round left the hand, SPAWN-28 / AI-121). tests/test_deployables.py runs it.
import * as THREE from 'three';
import { createDeployablesPage } from './deployables-page.js';

globalThis.window = globalThis;
const TABLE = {
  weapons: {
    Throw: {
      projectile: 'ThrowProjectile', projectilePosition: [0, 0, 3], velocity: 3,
      bomb: { timeToLive: 5, collision: true, mobile: true, response: false },
      spawner: { position: [0, -0.12, 2], minSpawnDelay: 0, maxSpawnDelay: 0, timeToLive: 0,
                 distance: 20, team: 0, maxNrOfObjectSpawned: 1, spawnOffset: [0, 0, 0],
                 damageWhenLost: 0, templates: { 0: 'Thing' } },
    },
  },
  objects: { Thing: { template: 'Thing', glb: 'Thing.glb', kind: 'PlayerControlObject',
                      vehicleCategory: 'VCLand', hitpoints: 50, maxHitpoints: 50, radius: 1 } },
};
globalThis.fetch = async () => ({ ok: true, json: async () => TABLE });

// A hill rising 40 degrees towards -z (the way the thrower looks).
const SLOPE = Math.tan(40 * Math.PI / 180);
const ground = (x, z) => -z * SLOPE;
const normal = (x, z, out) => {
  const len = Math.hypot(SLOPE, 1);
  out[0] = 0; out[1] = 1 / len; out[2] = SLOPE / len;
  return out;
};

async function run(mobile) {
  const spawnersRoot = new THREE.Group();
  const source = new THREE.Group();
  const pco = new THREE.Group();
  pco.name = 'Thing';
  pco.userData = { templateKind: 'PlayerControlObject', physics: mobile ? {} : { hasMobilePhysics: false } };
  source.add(pco);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.7, 0);
  // Looking 10 degrees down the hill's face, as a thrower aims at his feet.
  camera.rotation.set(-10 * Math.PI / 180, 0, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  const group = { node: pco };
  const page = {
    extras: { objectSpawns: [] }, loadouts: { kits: {} },
    spawnersRoot, currentRoot: spawnersRoot,
    kitDrops: { placeKit: () => null, objectAlive: () => false, objectPosition: () => null },
    guns: {}, params: new URLSearchParams('shots'), world: { flags: [], players: new Map() },
    MODELS_BASE: 'm', roomJoined: false,
    camera, handWeapon: { group, name: 'Throw' },
    soldier: { x: 0, y: 0, z: 0, body: { velocity: { x: 0, y: 0, z: 0 } } },
    soldierDead: false, optOnFoot: { checked: false }, optPilot: { checked: false },
    collider: { heightfield: { normal } },
    groundHeight: (x, z) => ground(x, z),
    loader: { loadAsync: async () => ({ scene: source }) },
  };
  const deployables = createDeployablesPage(page);
  await new Promise(r => setTimeout(r, 0));     // the table
  deployables.tick(1 / 30);
  page.guns.onShot(group, 1);
  for (let i = 0; i < 3; i++) { deployables.tick(1 / 30); await new Promise(r => setTimeout(r, 0)); }
  for (let i = 0; i < 60; i++) deployables.tick(1 / 30);
  const node = spawnersRoot.children.find(c => c.userData.deployed);
  node.updateMatrixWorld(true);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(node.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(node.quaternion);
  const view = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const p = window.__deployables.placed()[0];
  return {
    placed: !!node,
    fwd: fwd.toArray().map(v => +v.toFixed(3)),
    up: up.toArray().map(v => +v.toFixed(3)),
    view: view.toArray().map(v => +v.toFixed(3)),
    y: +node.position.y.toFixed(3),
    ground: +ground(node.position.x, node.position.z).toFixed(3),
    recordY: p?.at?.[1] ?? null,
  };
}

const out = { mobile: await run(true), fixed: await run(false) };
console.log(JSON.stringify(out));
