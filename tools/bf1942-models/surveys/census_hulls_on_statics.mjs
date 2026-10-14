#!/usr/bin/env node
// Census: every placed hull that stands on a static of its level, over the
// EXPORTED levels of every tree (the rows of each tree's maps.json, never the
// install's archives). For each hull the load settle's static rule
// (`viewer/static-settle.js`) is asked exactly as the page and the room ask it:
//
//   onStatic   `standsOnAStatic`: three or more of its twelve lowest col0
//              vertices rest on a static's top (a ramp, a pier, a floor)
//   sunk       `sunkIntoAStatic` deeper than SUNK_IN_A_STATIC: the level put
//              it into that static (COL-6 pushes it out on its first tick)
//   letDown    sunk with its wheels in a level floor: settled onto the floor
//              (FHSWEurope Operation Da's P-40 in its hangar)
//   unnamed    on a static no `DRIVABLE_TOP_RE` name covers: before
//              2026-10-14 its wheels sank to the terrain the first time it
//              woke; now the static is a ride surface at that height
//
//   residual   how far its hull (not its wheels, which rest into the floor by
//              their springs' compression) is still sunk after the static rule
//              of the load settle (`holdOnAStatic`, the page's and the
//              room's) has placed it;
//              more than SUNK_IN_A_STATIC is a defect (`audit_mod.py`
//              placement, cause `hull-sunk-in-static`)
//
//   node surveys/census_hulls_on_statics.mjs [--trees fhsweurope,fhsw] [--levels a,b] [--json out.json]
//
// `--json -` writes the report to stdout and the summary lines to stderr.
//
// From tools/bf1942-models. Loads each level headless (`server/level-load.mjs`);
// about 5 to 20 s a level.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks } from '../sim/env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = join(here, '..', 'viewer');
installModuleHooks(viewerDir);
const load = rel => import(pathToFileURL(join(here, '..', rel)).href);
const { loadRealLevel } = await load('server/level-load.mjs');
const { bodyPoseOf, bodySpecFor, writeBodyPose } = await load('server/level-bodies.mjs');
const { pruneToMode } = await load('viewer/game-modes.js');
const { buildCollisionIndex, isDrivableCollisionMesh } = await load('viewer/static-index.js');
const { holdOnAStatic, staticProbes } = await load('viewer/static-settle.js');
const { restingPoints, standsOnAStatic, standsOverTheSea, sunkIntoAStatic, SUNK_IN_A_STATIC } =
  await load('viewer/vehicle-bodies.js');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

/** Every tree with a maps.json: vanilla, then each mod. */
function trees() {
  const out = [{ id: 'bf1942', mod: null, maps: join(viewerDir, 'maps', 'maps.json') }];
  const modsDir = join(viewerDir, 'maps', 'mods');
  const registry = JSON.parse(readFileSync(join(viewerDir, 'models', 'mods.json'), 'utf8'));
  for (const id of (registry.mods ?? []).map(m => m.id)) {
    const maps = join(modsDir, id, 'maps.json');
    if (existsSync(maps)) out.push({ id, mod: id, maps });
  }
  return out;
}

function findSpawnersRoot(root) {
  let found = null;
  root.traverse(obj => {
    if (obj === root) return;
    if (obj.userData?.kind === 'spawners' || obj.name === 'spawners') found = obj;
  });
  return found;
}

function hasDrivableName(node) {
  let named = false;
  node.traverse(o => { if (!named && o.isMesh && isDrivableCollisionMesh(o)) named = true; });
  return named;
}

function censusLevel(tree, name) {
  const data = loadRealLevel({ viewerDir, name, mod: tree.mod });
  const root = data.sceneRoot;
  if (!root || !data.heightfield) return null;
  pruneToMode(root, data.extras?.gameplayMode);
  root.updateMatrixWorld(true);
  const spawnersRoot = findSpawnersRoot(root);
  const ownerRoots = [];
  for (const child of root.children) {
    if (child === spawnersRoot) ownerRoots.push(...child.children);
    else ownerRoots.push(child);
  }
  const probes = staticProbes(root, ownerRoots, buildCollisionIndex);
  const height = (x, z) => data.heightfield.height(x, z);
  const rows = [];
  let hulls = 0;
  for (const node of ownerRoots) {
    const spec = node?.userData?.armor ? bodySpecFor(node, data) : null;
    if (!spec) continue;
    hulls++;
    const pose = bodyPoseOf(node);
    if (standsOverTheSea(spec, pose, height, data.extras?.waterLevel)) continue;
    if (!standsOnAStatic(spec, pose, height, probes.staticTop)) continue;
    const { depth, level } = sunkIntoAStatic(spec, pose, height, probes.staticCross);
    const statics = new Set();
    for (const { top } of restingPoints(spec, pose, height, probes.staticUnder)) if (top.node) statics.add(top.node);
    const unnamed = [...statics].some(s => !hasDrivableName(s));
    // The settle's own rule, then the depth it leaves.
    holdOnAStatic(node, spec, pose, { heightfield: data.heightfield, probes, tables: data.damageTables,
      waterLevel: data.extras?.waterLevel, write: writeBodyPose });
    const residual = sunkIntoAStatic(spec, bodyPoseOf(node), height, probes.staticCross).hull;
    rows.push({
      residual: +residual.toFixed(2),
      hull: node.name, at: pose.position.map(n => +n.toFixed(2)),
      statics: [...statics].map(s => s.name), unnamed,
      sunk: depth > SUNK_IN_A_STATIC ? +depth.toFixed(2) : 0, letDown: depth > SUNK_IN_A_STATIC && level,
    });
  }
  return { hulls, rows };
}

const wanted = opt('--trees')?.split(',') ?? null;
const report = {};
for (const tree of trees()) {
  if (wanted && !wanted.includes(tree.id)) continue;
  const onlyLevels = opt('--levels')?.split(',').map(n => n.toLowerCase()) ?? null;
  // A row's directory is its glb's (`aberdeen/scene.glb` for `Aberdeen`).
  const levels = JSON.parse(readFileSync(tree.maps, 'utf8'))
    .map(r => ({ name: r.name ?? r.id, dir: String(r.glb ?? '').split('/')[0] || (r.name ?? r.id) }))
    .filter(r => !onlyLevels || onlyLevels.includes(r.dir.toLowerCase()) || onlyLevels.includes(String(r.name).toLowerCase()))
    .map(r => r.dir);
  const t = { levels: levels.length, scanned: 0, failed: [], hulls: 0, onStatic: 0, sunk: 0, letDown: 0, unnamed: 0,
    stillSunk: 0, rows: {} };
  for (const name of levels) {
    let result;
    try { result = censusLevel(tree, name); } catch (e) { t.failed.push(`${name}: ${e.message}`); if (process.env.CENSUS_DEBUG) console.error(e.stack); continue; }
    if (!result) { t.failed.push(`${name}: no scene or heightfield`); continue; }
    t.scanned++;
    t.hulls += result.hulls;
    for (const r of result.rows) {
      t.onStatic++;
      if (r.sunk) t.sunk++;
      if (r.letDown) t.letDown++;
      if (r.unnamed) t.unnamed++;
      if (r.residual > SUNK_IN_A_STATIC) t.stillSunk++;
    }
    if (result.rows.length) t.rows[name] = result.rows;
    process.stderr.write(`${tree.id}/${name}: ${result.hulls} hulls, ${result.rows.length} on statics\n`);
  }
  report[tree.id] = t;
  const line = `${tree.id}: ${t.scanned}/${t.levels} levels, ${t.hulls} hulls; on a static ${t.onStatic}, `
    + `sunk ${t.sunk} (let down ${t.letDown}), on an unnamed static ${t.unnamed}, still sunk after the settle `
    + `${t.stillSunk}` + (t.failed.length ? `; ${t.failed.length} failed` : '');
  if (opt('--json') === '-') console.error(line); else console.log(line);
}
const out = opt('--json');
if (out === '-') process.stdout.write(JSON.stringify(report));
else if (out) writeFileSync(out, JSON.stringify(report, null, 1));
