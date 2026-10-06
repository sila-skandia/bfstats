// Drives the kit pads of viewer/deployables-page.js under node: for every
// scene given, the pads the page builds from its `objectSpawns` against a
// loadouts file, the kits those pads lay down in their first second, and the
// level's baked copies they take out. tests/test_deployables.py runs it on a
// made-up level; features/dc-mortar-and-kit-pads runs it on a whole tree.
//
//   node kit_pads_harness.mjs <input.json>
//
// input: { loadouts: { kits: {...} }, scenes: [{ name, objectSpawns,
//          controlPoints, baked: [[x, y, z], ...] }] } -- `baked` stands a
// node of templateKind `Kit` at each point, as a bake's `spawners` group
// holds the level's inert copy of a pad's kit.
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createDeployablesPage } from './deployables-page.js';

globalThis.window = globalThis;
globalThis.fetch = async () => ({ ok: false, json: async () => null });

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const scenes = [];
for (const scene of input.scenes ?? []) {
  const spawnersRoot = new THREE.Group();
  for (const [x, y, z] of scene.baked ?? []) {
    const node = new THREE.Group();
    node.position.set(x, y, z);
    node.userData.templateKind = 'Kit';
    spawnersRoot.add(node);
  }
  spawnersRoot.updateMatrixWorld(true);
  const placed = [];
  const lying = new Map();
  const kitDrops = {
    placeKit: (kit, place, { objectId = null } = {}) => {
      placed.push({ kit, objectId, at: [place.x, place.y, place.z].map(v => +v.toFixed(3)) });
      lying.set(objectId, place);
      return { objectId };
    },
    objectAlive: id => lying.has(id),
    objectPosition: id => {
      const p = lying.get(id);
      return p ? [p.x, p.y, p.z] : null;
    },
  };
  const page = {
    extras: { objectSpawns: scene.objectSpawns ?? [], controlPoints: scene.controlPoints ?? [] },
    loadouts: input.loadouts,
    spawnersRoot,
    currentRoot: spawnersRoot,
    kitDrops,
    guns: {},
    params: new URLSearchParams('shots'),
    world: { flags: [] },
    MODELS_BASE: '',
    roomJoined: false,
  };
  const deployables = createDeployablesPage(page);
  for (let i = 0; i < 30; i++) deployables.tick(1 / 30);
  const pads = window.__deployables.pads();
  scenes.push({
    name: scene.name,
    spawns: page.extras.objectSpawns.length,
    pads: pads.map(p => ({ spawner: p.spawner, team: p.team, templates: p.templates,
                           slot: p.slot, place: p.place })),
    placed,
    bakedLeft: spawnersRoot.children.length,
  });
}
console.log(JSON.stringify({ scenes }));
