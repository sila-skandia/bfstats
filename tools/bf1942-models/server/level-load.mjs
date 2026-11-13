// A published maps tree entry, loaded headless into a LevelData: scene.json,
// the level `scene.glb`, the terrain material map, the shared companion files and
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
//
// Revised 2026-10-07: the drawn tiles are not the whole terrain (an undrawn
// patch is a hole, and 29 levels leave sea floor undrawn), so a tree that
// ships `terrain/heightmap.png` (the `heightmap` bake layer) is read instead.
// It equals the tile snap to the bit wherever a tile was drawn.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildHeightfield, heightfieldFromSamples } from '../viewer/heightfield.js';
import { loadVehicleTree, readGlb } from './glb-tree.mjs';
import { buildSceneTree, decodeMaterialIds, decodePng, readArmTracks } from './glb-scene.mjs';
import { LevelData } from './level-data.mjs';
import { applyTemplateWords } from '../viewer/template-words.js';

/**
 * Load a published maps tree entry, headless.
 *
 * `viewerDir` is the viewer directory (`.../viewer`); `name` is the level's
 * directory under `viewer/maps` (e.g. `wake`). Reads scene.json, the
 * scene.glb's JSON + BIN chunks, the terrain material map, and the shared
 * companion files (damage.json via scene.json's own `damage.path`, plus
 * collision-meshes.json and loadouts.json in `maps/_shared`), then builds
 * the terrain lattice with the page's own `buildHeightfield` law.
 *
 * `mod` names a mod's own trees (`maps/mods/<mod>`, `models/mods/<mod>`, the
 * page's `?mod=`); a template the mod tree does not hold is the vanilla
 * tree's, as it is on the page.
 */
export function loadRealLevel({ viewerDir, name, mod = null }) {
  const mapsDir = mod ? join(viewerDir, 'maps', 'mods', mod) : join(viewerDir, 'maps');
  const levelDir = join(mapsDir, name);
  const sharedDir = join(mapsDir, '_shared');
  const scenePath = join(levelDir, 'scene.json');
  if (!existsSync(scenePath)) throw new Error(`no scene.json for level "${name}"`);

  const extras = JSON.parse(readFileSync(scenePath, 'utf8'));
  if (!existsSync(join(levelDir, 'scene.glb')) && existsSync(join(levelDir, 'scene.remote.json'))) {
    throw new Error(`level "${name}" is remote-only (its scene.glb is on the volume): `
      + `tools/bf1942-models/evict_levels.py restore --mod ${mod || 'bf1942'} ${name}`);
  }
  const { json, bin } = readGlb(join(levelDir, 'scene.glb'));
  const { root, terrainTiles } = buildSceneTree(json, bin);
  // A tree baked before the exporter read the rocket and submarine words
  // takes them from the level's table, as the page does
  // (`viewer/template-words.js`): an Engine's heat stops the room's Natter
  // too (PHY-45).
  applyTemplateWords(root, extras.templateWords);

  // The heightfield, shared read-only by every room: the level's whole
  // heightmap where the tree ships it (`terrain/heightmap.png`, the page's
  // `heightfieldFromSamples`), so an undrawn patch still has ground; else
  // recovered from the terrain tiles by the page's own snap law (see the
  // header comment), holes and all.
  const hm = extras?.heightmap;
  const hmPath = hm?.image ? join(levelDir, hm.image) : null;
  let heightfield = null;
  if (hmPath && existsSync(hmPath)) {
    const png = decodePng(readFileSync(hmPath), hm.image);
    heightfield = heightfieldFromSamples(png.data, { ...hm, channels: png.channels });
  }
  heightfield ??= buildHeightfield(terrainTiles, {
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

  // Shared companion files. `extras.damage.path` is URI-style ("../_shared/...").
  const damageTables = readShared(sharedDir, levelDir, extras.damage?.path, 'damage.json');
  const collisionMeshes = readShared(sharedDir, levelDir, null, 'collision-meshes.json');
  // Which parts meet the ground and the sea (`vehicle-bodies.js`
  // `partIsMobile`, ledger HP-21): the companion file's own `mobility`, else the
  // tree's `part-mobility.json`, as the page's `hull-bodies.js` loads it.
  // Without it every part reads as mobile, and a static part's empty
  // `checkVsTerrain` became a full one here.
  if (collisionMeshes && !collisionMeshes.mobility) {
    const table = readShared(sharedDir, levelDir, null, 'part-mobility.json');
    if (table?.mobility) collisionMeshes.mobility = table.mobility;
  }
  const loadouts = readShared(sharedDir, levelDir, null, 'loadouts.json');
  // The soldier templates' body words (`explosionForceMod`/`Max`, KNOCK-7),
  // which the tree's gait manifest carries (`extract_pose.py`); the page reads
  // the same file (`foot-body.js`). Null for a tree without it.
  const modelsDirs = mod
    ? [join(modelsDirOf(viewerDir), 'mods', mod), modelsDirOf(viewerDir)] : [modelsDirOf(viewerDir)];
  const gaitsPath = modelsDirs.map(dir => join(dir, 'poses', 'gaits', 'gaits.json')).find(existsSync)
    ?? join(modelsDirs[0], 'poses', 'gaits', 'gaits.json');
  let soldierBody = null;
  if (existsSync(gaitsPath)) {
    try { soldierBody = JSON.parse(readFileSync(gaitsPath, 'utf8'))?.soldierBody ?? null; } catch { /* none */ }
  }

  // The published template trees, cached per template name: every layer's
  // (a room may play any of them, `LevelData.instantiate(mode)`), and every
  // template a pad can hand out (`objectSpawns[].templates`, SPAWN-2), which
  // is the other side's vehicle on a pad whose flag changes hands.
  const templates = new Map();
  const layers = [extras, ...Object.values(extras.modes || {})];
  const names = new Set();
  for (const layer of layers) {
    for (const spawn of [...(layer?.objectSpawns || []), ...(layer?.vehicleSoldierSpawns || [])]) {
      if (spawn?.vehicle) names.add(String(spawn.vehicle));
      for (const name of Object.values(spawn?.templates || {})) if (name) names.add(String(name));
    }
  }
  for (const name of names) {
    const template = name.toLowerCase();
    if (templates.has(template)) continue;
    const path = modelsDirs.map(dir => resolveTemplatePath(dir, name)).find(existsSync);
    if (!path) continue;
    const tree = loadVehicleTree(path);
    applyTemplateWords(tree?.scene ?? tree?.root ?? tree, extras.templateWords);
    templates.set(template, tree);
  }
  loadRoundTemplates(templates, extras, name => modelsDirs.map(dir => resolveTemplatePath(dir, name)).find(existsSync));

  return new LevelData({
    name, extras, sceneRoot: root, heightfield, damageTables,
    collisionMeshes, templates, colliderMock: null, loadouts, soldierBody,
    armTracks: readArmTracks(json, bin),
    // Where the level's own files are, for what a room's bots are made from
    // (`room-bots.mjs` `botDataFor`: weapon glbs, names, search maps).
    paths: { levelDir, sharedDir, modelsDirs, glbsDir: join(viewerDir, 'glbs') },
  });
}

/**
 * The vehicles a loaded hull's FireArms throws as its round
 * (`fireArms.projectile.vehicle`, FA-29: the Wasserfall's rocket), loaded
 * beside it so a room can stand one (`room-missiles.mjs`). `resolve(name)`
 * answers the template's glb path, or nothing. A round's own guns are
 * followed too.
 */
export function loadRoundTemplates(templates, extras, resolve) {
  const queue = [...templates.values()];
  while (queue.length) {
    const tree = queue.pop();
    const wanted = [];
    tree?.traverse?.(node => {
      const p = node.userData?.fireArms?.projectile;
      if (p && typeof p === 'object' && p.vehicle === true && p.template) wanted.push(String(p.template));
    });
    for (const name of wanted) {
      const key = name.toLowerCase();
      if (templates.has(key)) continue;
      const path = resolve(name);
      if (!path || !existsSync(path)) continue;
      const round = loadVehicleTree(path);
      applyTemplateWords(round, extras?.templateWords);
      templates.set(key, round);
      queue.push(round);
    }
  }
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
  return storedTemplatePath(modelsDir, template) ?? join(modelsDir, `${template}.glb`);
}

/** modelsDir -> its `models.json` rows' blobs, `glb stem (lower) -> sha`. */
const storeTables = new Map();

/**
 * The same template on a published tree, which keeps each glb once, by its
 * content, under `<viewer>/glbs/<sha>.glb` and names it in the tree's
 * `models.json` (`viewer/glb-store.js`, features/mesh-asset-size phase 5):
 * there is no `models/<Template>.glb` there at all, so until 2026-11-13 a
 * room on the live volume found no vehicle template. The row's own glb
 * first, else a variant's (`<Template>.<Level>.glb`), as the scan above
 * prefers them. Null for a tree with no manifest, a name it does not list,
 * or a blob that is not on disk.
 */
export function storedTemplatePath(modelsDir, template) {
  let table = storeTables.get(modelsDir);
  if (table === undefined) {
    table = null;
    try {
      const rows = JSON.parse(readFileSync(join(modelsDir, 'models.json'), 'utf8'));
      table = new Map();
      const put = row => {
        const key = String(row?.glb ?? '').replace(/\.glb$/i, '').toLowerCase();
        if (key && row.sha && !table.has(key)) table.set(key, row.sha);
      };
      for (const row of Array.isArray(rows) ? rows : []) {
        put(row);
        for (const variant of row?.variants ?? []) put(variant);
      }
    } catch { table = null; }
    storeTables.set(modelsDir, table);
  }
  if (!table) return null;
  const want = String(template).toLowerCase();
  let sha = table.get(want) ?? null;
  if (!sha) for (const [key, value] of table) if (key.startsWith(`${want}.`) && !key.endsWith('.cockpit')) { sha = value; break; }
  if (!sha) return null;
  // `<viewer>/glbs`: beside the `models` directory this tree hangs under
  // (`models`, or `models/mods/<mod>`).
  let root = modelsDir;
  for (let i = 0; i < 4 && !/[\\/]models[\\/]?$/.test(root); i++) root = join(root, '..');
  const blob = join(root, '..', 'glbs', `${sha}.glb`);
  return existsSync(blob) ? blob : null;
}

/**
 * One companion file, first match of the level-relative URI (scene.json's own
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
      throw new Error(`bad companion file ${path}: ${error.message}`);
    }
  }
  return null;
}
