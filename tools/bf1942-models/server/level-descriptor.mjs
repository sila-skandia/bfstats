// Descriptor levels: the harness's `test` level and any level built from an
// EXTRAS-shaped descriptor rather than a maps tree entry. Split out of
// `level.mjs`, which re-exports `fakeLevelDescriptor` and
// `buildLevelFromDescriptor`.

import { existsSync } from 'node:fs';

import { loadVehicleTree } from './glb-tree.mjs';
import { LevelData } from './level-data.mjs';
import { modelsDirOf, resolveTemplatePath } from './level-load.mjs';

/**
 * The harness level: a flat-ground mock collider, two flags and a pair of
 * seatable vehicles resolved from the models dir. `rooms.mjs` registers it
 * under the name `test`, so the socket test drives the whole junction
 * without a real map — the same way `world_harness`'s collider mock stands
 * in for the page's buildCollider.
 */
export function fakeLevelDescriptor({ viewerDir }) {
  return {
    name: 'test',
    extras: {
      worldSize: 600,
      gameplayMode: 'Conquest',
      controlPoints: [
        { name: 'North', spawnGroupId: 1, team: 1, position: [10, 0, 10] },
        { name: 'South', spawnGroupId: 2, team: 2, position: [-10, 0, -10] },
      ],
      soldierSpawns: [
        // rotation [180,0,0] so `spawnYaw` is 0 — the page yaw that faces +Z.
        { name: 'N1', group: 1, team: 1, position: [10, 0, 10], rotation: [180, 0, 0] },
        { name: 'N2', group: 1, team: 1, position: [14, 0, 10], rotation: [180, 0, 0] },
        { name: 'S1', group: 2, team: 2, position: [-10, 0, -10], rotation: [180, 0, 0] },
        { name: 'S2', group: 2, team: 2, position: [-14, 0, -10], rotation: [180, 0, 0] },
      ],
      tickets: { team1: 100, team2: 100,
        lossPerMin: { team1: 30, team2: 30 } },
    },
    collider: {
      waterLevel: null,
      heightfield: null,
      statics: null,
      surfaceHeight(x, z) { return 0; },
    },
    vehicles: [
      // Real published templates (the harness copies the glbs into its temp
      // overlay), so the seat table, the drive model and the body spec are
      // the real thing rather than a hand-built fixture.
      { vehicle: 'Willy', team: 1, position: [40, 0, 40], rotation: [0, 0, 0],
        minSpawnDelay: 40, maxSpawnDelay: 80 },
      { vehicle: 'Zero', team: 2, position: [-40, 0, -40], rotation: [0, 0, 0],
        minSpawnDelay: 40, maxSpawnDelay: 80 },
    ],
  };
}

/**
 * A LevelData built from a descriptor rather than a maps tree entry: the
 * vehicle instances are clones of the published template trees at the
 * descriptor's poses; no scene.glb, no heightfield, no sidecars. The room's
 * World runs on the descriptor's collider mock (flat ground by default).
 */
export function buildLevelFromDescriptor({ viewerDir, descriptor = null }) {
  const spec = descriptor || fakeLevelDescriptor({ viewerDir });
  const templates = new Map();
  for (const v of spec.vehicles || []) {
    const name = String(v.vehicle || '').toLowerCase();
    if (templates.has(name)) continue;
    const path = resolveTemplatePath(modelsDirOf(viewerDir), String(v.vehicle || ''));
    if (!existsSync(path)) continue;
    templates.set(name, loadVehicleTree(path));
  }
  return new LevelData({
    name: spec.name || 'test',
    extras: spec.extras,
    sceneRoot: null,
    heightfield: null,
    damageTables: null,
    collisionMeshes: null,
    templates,
    colliderMock: spec.collider || null,
    loadouts: null,
    descriptor: spec,
  });
}
