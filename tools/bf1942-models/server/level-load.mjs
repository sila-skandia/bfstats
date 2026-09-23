// A published maps tree entry, loaded headless into a LevelData: scene.json,
// the level `scene.glb`, the terrain material map, the shared sidecars and
// the vehicle template trees. Split out of `level.mjs`, which re-exports
// `loadRealLevel`.
//
// THE HEIGHTFIELD DECISION (documented in `server/README.md`): the terrain
// lattice is recovered from the level's own `scene.glb` at load, the same
// way the page's `buildHeightfield` recovers it from the loaded scene — the
// exporter writes tile vertices at absolute world positions on exact
// multiples of the sample spacing, so snapping recovers `Heightmap.raw`
// exactly, and the JSON chunk's nodes name every tile (`extras.kind
// "terrain"`). No new asset, never out of sync with the scene, and the law
// stays in `collision.js`; the cost is one accessor decode per level
// (~270 k vertices) against the alternative bake script, which would need a
// publish step and a second source of truth to drift against.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildHeightfield } from '../viewer/collision.js';
import { loadVehicleTree, readGlb } from './glb-tree.mjs';
import { buildSceneTree, decodeMaterialIds } from './glb-scene.mjs';
import { LevelData } from './level-data.mjs';

/**
 * Load a published maps tree entry, headless.
 *
 * `viewerDir` is the viewer directory (`.../viewer`); `name` is the level's
 * directory under `viewer/maps` (e.g. `wake`). Reads scene.json, the
 * scene.glb's JSON + BIN chunks, the terrain material map, and the shared
 * sidecars (damage.json via scene.json's own `damage.path`, plus
 * collision-meshes.json and loadouts.json in `maps/_shared`), then builds
 * the terrain lattice with the page's own `buildHeightfield` law.
 */
export function loadRealLevel({ viewerDir, name }) {
  const mapsDir = join(viewerDir, 'maps');
  const levelDir = join(mapsDir, name);
  const sharedDir = join(mapsDir, '_shared');
  const scenePath = join(levelDir, 'scene.json');
  if (!existsSync(scenePath)) throw new Error(`no scene.json for level "${name}"`);

  const extras = JSON.parse(readFileSync(scenePath, 'utf8'));
  const { json, bin } = readGlb(join(levelDir, 'scene.glb'));
  const { root, terrainTiles } = buildSceneTree(json, bin);

  // The heightfield, recovered from the terrain tiles by the page's own snap
  // law (see the header comment), shared read-only by every room.
  const heightfield = buildHeightfield(terrainTiles, {
    worldSize: extras?.worldSize || 0,
    dim: extras?.terrain?.materials?.dim || 0,
  });

  // The per-sample material id map: the red channel of the authored PNG.
  const terrain = extras?.terrain || {};
  const materials = terrain.materials;
  if (heightfield && materials?.image) {
    const pngPath = join(levelDir, materials.image);
    if (existsSync(pngPath)) {
      const ids = decodeMaterialIds(readFileSync(pngPath));
      heightfield.setMaterials(ids, materials.dim, materials.spacing
        || heightfield.spacing);
    }
  }

  // Shared sidecars. `extras.damage.path` is URI-style ("../_shared/...").
  const damageTables = readShared(sharedDir, levelDir, extras.damage?.path, 'damage.json');
  const collisionMeshes = readShared(sharedDir, levelDir, null, 'collision-meshes.json');
  const loadouts = readShared(sharedDir, levelDir, null, 'loadouts.json');

  // The published template trees, cached per template name.
  const templates = new Map();
  for (const spawn of [...(extras.objectSpawns || []),
    ...(extras.vehicleSoldierSpawns || [])]) {
    const template = String(spawn.vehicle || '').toLowerCase();
    if (templates.has(template)) continue;
    const path = resolveTemplatePath(modelsDirOf(viewerDir), String(spawn.vehicle || ''));
    if (!existsSync(path)) continue;
    templates.set(template, loadVehicleTree(path));
  }

  return new LevelData({
    name, extras, sceneRoot: root, heightfield, damageTables,
    collisionMeshes, templates, colliderMock: null, loadouts,
  });
}

export function modelsDirOf(viewerDir) { return join(viewerDir, 'models'); }

/**
 * A template's published glb, matched case-insensitively: the plain
 * `<Template>.glb` when it exists (replica/replay assets), else the first
 * per-level instance (`<Template>.<Level>.glb` — the extractor publishes
 * most vehicles under the level they were captured from; the seat trees are
 * identical across instances, so any one mounts the same way). Scene JSON
 * spells vehicle names lowercase and the files are CamelCase, so the whole
 * match is case-folded.
 */
export function resolveTemplatePath(modelsDir, template) {
  const stem = `${template.toLowerCase()}.`;
  let plain = null;
  let prefixed = null;
  try {
    for (const entry of readdirSync(modelsDir)) {
      const lower = entry.toLowerCase();
      if (!lower.startsWith(stem) || !lower.endsWith('.glb')) continue;
      if (lower === `${stem}glb` && plain === null) plain = entry;
      else if (prefixed === null) prefixed = entry;
      if (plain && prefixed) break;
    }
  } catch { /* the models dir is optional on a bare harness */ }
  if (plain) return join(modelsDir, plain);
  if (prefixed) return join(modelsDir, prefixed);
  return join(modelsDir, `${template}.glb`);
}

/**
 * One sidecar, first match of the level-relative URI (scene.json's own
 * `damage.path`) then the `_shared` name; null when neither exists (an old
 * extract, a harness overlay) — never throws.
 */
function readShared(sharedDir, levelDir, uri, fallbackName) {
  const candidates = [];
  if (uri) candidates.push(join(levelDir, uri));
  if (fallbackName) candidates.push(join(sharedDir, fallbackName));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`bad sidecar ${path}: ${error.message}`);
    }
  }
  return null;
}
