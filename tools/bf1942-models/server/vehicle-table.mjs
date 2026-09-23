// A room's vehicle table: one entry per seatable spawn (objectSpawns ∪
// vehicleSoldierSpawns, or a fake descriptor's rows), matched to its cloned
// scene instance under the level's spawners node, or — for an extract that
// predates the pad — a template clone at the authored pose. Split out of
// `level.mjs`'s LevelInstance, which builds its `table` with this.

import * as THREE from 'three';

import { classifyRoot, listEntryPoints } from '../viewer/seats.js';
import { spawnerWindow } from '../viewer/game-modes.js';

/** The template a placed node is an instance of (map.html `templateNameOf`). */
function templateNameOf(node) {
  return node?.userData?.control || node?.name || '';
}

/**
 * The table for one LevelInstance (its `spawnersRoot`, `ownerRoots` and
 * `world`): `{id, template, owner, root, kind, window, team, seated,
 * driver}` rows, `id` = 1-based index (see LevelInstance).
 */
export function buildVehicleTable({ spawnersRoot, ownerRoots, world }, data) {
  const table = [];
  const spawners = spawnersRoot?.children || [];
  const extras = data.extras;
  let nextOwner = ownerRoots.length;

  const addEntry = (spawn) => {
    const template = String(spawn.vehicle || '');
    const tree = data.templates.get(template.toLowerCase());
    if (!tree) return;                          // no published model: unmountable
    if (listEntryPoints(tree).length === 0) return;  // ships and scenery stay out
    const kind = classifyRoot(tree) || 'seat';
    const window = spawnerWindow(spawn.spawner, extras?.gameplayMode) ?? (
      (Number.isFinite(spawn.minSpawnDelay) || Number.isFinite(spawn.maxSpawnDelay))
        ? { minSpawnDelay: spawn.minSpawnDelay, maxSpawnDelay: spawn.maxSpawnDelay }
        : null);
    const want = template.toLowerCase();
    const pos = spawn.position || [];
    let instance = null;
    let best = null;
    let bestDist = Infinity;
    for (const node of spawners) {
      const name = templateNameOf(node).toLowerCase();
      if (name !== want && !name.startsWith(want)) continue;
      node.updateWorldMatrix(true, false);
      const p = node.getWorldPosition(new THREE.Vector3());
      const dist = pos.length === 3
        ? Math.hypot(p.x - pos[0], p.y - pos[1], p.z - pos[2]) : 0;
      if (dist < bestDist) { bestDist = dist; best = node; }
    }
    const entry = {
      id: table.length + 1,
      template,
      owner: -1,
      root: null,
      kind,
      window,
      team: spawn.team ?? null,
      seated: 0,            // players currently mounted in this hull
      driver: null,         // the player holding the drive, if any
    };
    if (best) {
      entry.owner = ownerRoots.indexOf(best);
      entry.root = best;
    } else {
      // No scene instance: a template clone at the authored pose, parked
      // in as damageable furniture with a position but no static hull
      // (it cannot collide until an extractor rebuilds the level).
      entry.owner = nextOwner++;
      entry.root = tree.clone(true);
      entry.root.name = `${template}_placeholder`;
      if (pos.length === 3) entry.root.position.set(pos[0], pos[1], pos[2]);
      if (Array.isArray(spawn.rotation) && spawn.rotation.length >= 3) {
        entry.root.quaternion.setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(spawn.rotation[0]),
          THREE.MathUtils.degToRad(spawn.rotation[1]),
          THREE.MathUtils.degToRad(spawn.rotation[2]), 'XYZ'));
      }
      entry.root.updateMatrixWorld(true);
      const armorExtras = entry.root.userData?.armor;
      if (armorExtras) {
        const p = entry.root.getWorldPosition(new THREE.Vector3());
        world.addDamageable(entry.owner, entry.root, armorExtras, {
          name: entry.root.name, position: [p.x, p.y, p.z] });
      }
    }
    table.push(entry);
  };

  for (const spawn of data.spawnables) addEntry(spawn);
  return table;
}
