// A room's vehicle table: one entry per seatable spawn (objectSpawns ∪
// vehicleSoldierSpawns, or a fake descriptor's rows), matched to its cloned
// scene instance under the level's spawners node, or — for an extract that
// predates the pad — a template clone at the authored pose. Split out of
// `level.mjs`'s LevelInstance, which builds its `table` with this.
//
// An `objectSpawns` row is a vehicle pad (`room-pads.mjs`), and its entry
// finds its node the way the page's pad does (`level-statics.js`
// `bakedPadNode`: the pad's template within 3 m, one node per pad), so the
// two sides stand the same hull on the same pad. Each entry carries what the
// page needs to find its own copy of the hull: `pad`, the row's index in
// the layer's `objectSpawns`, and `node`, the hull's node index in
// `scene.glb` (`glb-scene.mjs` `levelNode`).

import * as THREE from 'three';

import { classifyRoot, listEntryPoints } from '../viewer/seats.js';
import { spawnerWindow } from '../viewer/game-modes.js';
import { bakedPadNode } from '../viewer/level-statics.js';

/** The template a placed node is an instance of (map.html `templateNameOf`). */
function templateNameOf(node) {
  return node?.userData?.control || node?.name || '';
}

/**
 * The table for one LevelInstance (its `spawnersRoot`, `ownerRoots` and
 * `world`): `{id, template, owner, root, kind, window, team, seated, driver,
 * pad, node, home}` rows, `id` = 1-based index (see LevelInstance). `home` is
 * the pose the entry stands at when its pad stands it up.
 */
export function buildVehicleTable(instance, data) {
  const { spawnersRoot, ownerRoots, world, extras: layer, spawnables } = instance;
  const table = [];
  const spawners = spawnersRoot?.children || [];
  const extras = layer ?? data.extras;
  const pads = Array.isArray(extras?.objectSpawns) ? extras.objectSpawns : [];
  const claimed = new Set();
  // Owner ids past the level's own roots, for the entries no scene node
  // stands for: the placeholders below and the pads' other-side vehicles.
  instance.nextOwner = ownerRoots.length;

  const addEntry = (spawn) => {
    const template = String(spawn.vehicle || '');
    const tree = data.templates.get(template.toLowerCase());
    if (!tree) return;                          // no published model: unmountable
    if (listEntryPoints(tree).length === 0) return;  // ships and scenery stay out
    const window = spawnerWindow(spawn.spawner, extras?.gameplayMode) ?? (
      (Number.isFinite(spawn.minSpawnDelay) || Number.isFinite(spawn.maxSpawnDelay))
        ? { minSpawnDelay: spawn.minSpawnDelay, maxSpawnDelay: spawn.maxSpawnDelay }
        : null);
    // A pad is a pad where the page makes it one: its baked hull stands in
    // the spawners group (`bakedPadNode`). A row whose hull the bake placed
    // elsewhere (a stationary gun stood among the statics) is level
    // furniture on the page, and here: its node wherever it stands, no pad.
    // A row with no node anywhere (a descriptor, an extract older than the
    // pad) keeps its pad on a template clone, as before.
    let pad = pads.indexOf(spawn);
    let best = pad >= 0 && spawnersRoot ? bakedPadNode(spawnersRoot, spawn, 3, claimed) : null;
    if (!best) {
      const want = template.toLowerCase();
      const pos = spawn.position || [];
      let bestDist = Infinity;
      for (const node of [...spawners, ...ownerRoots]) {
        if (claimed.has(node)) continue;
        const name = templateNameOf(node).toLowerCase();
        if (name !== want && !name.startsWith(want)) continue;
        node.updateWorldMatrix(true, false);
        const p = node.getWorldPosition(new THREE.Vector3());
        const dist = pos.length === 3
          ? Math.hypot(p.x - pos[0], p.y - pos[1], p.z - pos[2]) : 0;
        if (dist < bestDist) { bestDist = dist; best = node; }
      }
      if (best) pad = -1;
    }
    if (best) claimed.add(best);
    const entry = best
      ? newEntry(table, { template, tree, window, team: spawn.team ?? null,
                          pad: pad >= 0 ? pad : null, owner: ownerRoots.indexOf(best), root: best })
      : placeholderEntry(instance, table, { template, tree, window, team: spawn.team ?? null,
                                            pad: pad >= 0 ? pad : null, spawn });
    if (entry) table.push(entry);
  };

  for (const spawn of spawnables ?? data.spawnables) addEntry(spawn);
  return table;
}

/** One table row. `root` stands in the scene (or is a clone nothing parents). */
function newEntry(table, { template, tree, window, team, pad, owner, root }) {
  root.updateMatrixWorld(true);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  root.matrixWorld.decompose(position, quaternion, new THREE.Vector3());
  return {
    id: table.length + 1,
    template,
    owner,
    root,
    kind: classifyRoot(tree) || 'seat',
    window,
    team,
    seated: 0,            // players currently mounted in this hull
    driver: null,         // the player holding the drive, if any
    pad,                  // index into the layer's objectSpawns, or null
    node: root.levelNode ?? null,
    home: { position, quaternion },
    live: true,           // standing in the world (`room-pads.mjs` keeps it)
  };
}

/**
 * A row no scene node stands for: a clone of the template tree at a pose,
 * registered as damageable with a position but no static hull (it cannot
 * collide until an extractor rebuilds the level). `spawn` gives the authored
 * pose (an extract that predates the pad); `at` a world `{position,
 * quaternion}` (a pad's other-side vehicle, stood where the baked one is).
 */
export function placeholderEntry(instance, table, { template, tree, window = null, team = null,
                                                    pad = null, spawn = null, at = null }) {
  const owner = instance.nextOwner++;
  const root = tree.clone(true);
  root.name = `${template}_placeholder`;
  if (at) {
    root.position.copy(at.position);
    root.quaternion.copy(at.quaternion);
  } else {
    const pos = spawn?.position || [];
    if (pos.length === 3) root.position.set(pos[0], pos[1], pos[2]);
    if (Array.isArray(spawn?.rotation) && spawn.rotation.length >= 3) {
      root.quaternion.setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(spawn.rotation[0]),
        THREE.MathUtils.degToRad(spawn.rotation[1]),
        THREE.MathUtils.degToRad(spawn.rotation[2]), 'XYZ'));
    }
  }
  root.updateMatrixWorld(true);
  const armorExtras = root.userData?.armor;
  if (armorExtras) {
    const p = root.getWorldPosition(new THREE.Vector3());
    instance.world.addDamageable(owner, root, armorExtras, { name: root.name, position: [p.x, p.y, p.z] });
  }
  return newEntry(table, { template, tree, window, team, pad, owner, root });
}
