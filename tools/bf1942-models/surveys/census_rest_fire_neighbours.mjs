#!/usr/bin/env node
// Census: every placed gun whose round, fired at the gun's rest pose, bursts
// with another placed hull inside its splash, over the EXPORTED levels of each
// tree (the rows of its maps.json, never the install's archives).
//
// The shape that read as "Stationary_Vickers fires no shots and does not
// traverse" on FHSWEurope 203_hill-1904 (2026-10-15,
// `features/fhswe-mechanics-audit`, item 13): the level stands a three-gun
// French 155 mm battery 26 m uphill of a Vickers trench, pitched 14 degrees
// down the slope (`Object.rotation 0/14/0`). Fired near its rest elevation its
// first round meets the trench's timber 24 m out, and a 26 m splash takes the
// 75-hit-point Vickers to 0. The quick behaviour audit fires every hull in turn
// in one page, so the next template it manned was that wreck, which takes no
// input (HP-15) and fires nothing. The level's data and the page are both
// right; the harness tested a wreck.
//
// For each placed hull with armour, each primary FireArms (`c_PIFire`) whose
// round splashes (`projectile-damage.js` `splashSpec`) is fired from each of
// its muzzles at rest, flown ballistically (`effects-core.js` GRAVITY times
// the round's `gravity`) and stopped at the first terrain or static triangle
// (`static-index.js` `cast`, the gun's own owner skipped). Every other placed
// hull whose origin lies inside the splash radius of that point is a row.
// Terrain and statics only: hulls do not stop the round here, so the count is
// an upper bound on what a first salvo can reach.
//
//   node surveys/census_rest_fire_neighbours.mjs [--trees fhsweurope,fhsw,fh] [--levels a,b] [--json out.json]
//
// From tools/bf1942-models. Loads each level headless (`server/level-load.mjs`).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks } from '../sim/env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = join(here, '..', 'viewer');
installModuleHooks(viewerDir);
const load = rel => import(pathToFileURL(join(here, '..', rel)).href);
const THREE = await import('three');
const { loadRealLevel } = await load('server/level-load.mjs');
const { pruneToMode } = await load('viewer/game-modes.js');
const { buildCollisionIndex } = await load('viewer/static-index.js');
const { splashSpec } = await load('viewer/projectile-damage.js');
const { GRAVITY } = await load('viewer/effects-core.js');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DT = 1 / 60;
const MAX_RANGE = 2000;

/** The mode the behaviour audit plays (`audit_behaviour.mjs` `pickMode`). */
function pickMode(extras) {
  const types = Object.keys(extras?.gameTypes || {});
  if (types.includes('CoOp')) return 'CoOp';
  if (extras?.gameplayMode && types.includes(extras.gameplayMode)) return extras.gameplayMode;
  if (types.includes('Conquest')) return 'Conquest';
  return types[0] || 'Conquest';
}

function findSpawnersRoot(root) {
  let found = null;
  root.traverse(obj => {
    if (obj === root) return;
    if (obj.userData?.kind === 'spawners' || obj.name === 'spawners') found = obj;
  });
  return found;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _d = new THREE.Vector3();
const hit = {};

/** Where a round from `muzzle` stops, or null inside MAX_RANGE / its life. */
function flight(muzzle, fa, index, height, skipOwner) {
  muzzle.getWorldPosition(_p);
  muzzle.getWorldQuaternion(_q);
  _d.set(0, 0, -1).applyQuaternion(_q);
  const v = _d.clone().multiplyScalar(fa.velocity || 0);
  if (!(v.lengthSq() > 0)) return null;
  const g = GRAVITY * (fa.projectile?.gravity ?? 1);
  const ttl = fa.projectile?.timeToLive || 10;
  const p = _p.clone();
  let travelled = 0;
  for (let t = 0; t < ttl && travelled < MAX_RANGE; t += DT) {
    const step = v.clone().multiplyScalar(DT);
    const len = step.length();
    const dir = step.clone().divideScalar(len);
    const c = index.cast(p.x, p.y, p.z, dir.x, dir.y, dir.z, len, skipOwner, hit);
    if (c) return { point: p.clone().addScaledVector(dir, c.t), travelled: travelled + c.t, on: 'static' };
    p.add(step);
    travelled += len;
    v.y += g * DT;
    const ground = height(p.x, p.z);
    if (Number.isFinite(ground) && p.y <= ground) return { point: p.clone().setY(ground), travelled, on: 'terrain' };
  }
  return null;
}

function censusLevel(tree, name) {
  const data = loadRealLevel({ viewerDir, name, mod: tree.mod });
  const root = data.sceneRoot;
  if (!root || !data.heightfield) return null;
  const mode = pickMode(data.extras);
  pruneToMode(root, mode);
  root.updateMatrixWorld(true);
  const spawnersRoot = findSpawnersRoot(root);
  const ownerRoots = [];
  for (const child of root.children) {
    if (child === spawnersRoot) ownerRoots.push(...child.children);
    else ownerRoots.push(child);
  }
  const hulls = ownerRoots.filter(n => n?.userData?.armor);
  const index = buildCollisionIndex(root, { ownerRoots });
  const height = (x, z) => data.heightfield.height(x, z);
  const at = new Map(hulls.map(h => [h, h.getWorldPosition(new THREE.Vector3())]));
  const rows = [];
  let guns = 0;
  for (const hull of hulls) {
    const owner = index.ownerOf(hull);
    hull.traverse(node => {
      const fa = node.userData?.fireArms;
      if (node.userData?.templateKind !== 'FireArms' || !fa || (fa.input && fa.input !== 'c_PIFire')) return;
      const splash = splashSpec(fa.projectile?.damage);
      if (!splash) return;
      guns++;
      const muzzles = [];
      node.traverse(m => { if (m.userData?.templateKind === 'Muzzle') muzzles.push(m); });
      if (!muzzles.length) muzzles.push(node);
      for (const muzzle of muzzles) {
        const f = flight(muzzle, fa, index, height, owner);
        if (!f) continue;
        for (const other of hulls) {
          if (other === hull) continue;
          const d = at.get(other).distanceTo(f.point);
          if (!(splash.radius > d)) continue;
          rows.push({
            gun: hull.userData.control ?? hull.name, gunAt: at.get(hull).toArray().map(n => +n.toFixed(1)),
            fireArms: node.name, travelled: +f.travelled.toFixed(1), on: f.on, radius: splash.radius,
            neighbour: other.userData.control ?? other.name, neighbourAt: at.get(other).toArray().map(n => +n.toFixed(1)),
            distance: +d.toFixed(1), neighbourHp: other.userData.armor?.hitpoints ?? null,
          });
        }
      }
    });
  }
  return { mode, hulls: hulls.length, guns, rows };
}

/** The tree ids with a maps.json under viewer/maps/mods. */
function trees(wanted) {
  return wanted.map(id => ({ id, mod: id === 'bf1942' ? null : id,
    maps: id === 'bf1942' ? join(viewerDir, 'maps', 'maps.json') : join(viewerDir, 'maps', 'mods', id, 'maps.json') }))
    .filter(t => existsSync(t.maps));
}

const report = {};
const onlyLevels = opt('--levels')?.split(',').map(n => n.toLowerCase()) ?? null;
for (const tree of trees(opt('--trees')?.split(',') ?? ['fhsweurope', 'fhsw', 'fh'])) {
  const levels = JSON.parse(readFileSync(tree.maps, 'utf8'))
    .map(r => ({ name: r.name ?? r.id, dir: String(r.glb ?? '').split('/')[0] || (r.name ?? r.id) }))
    .filter(r => !onlyLevels || onlyLevels.includes(r.dir.toLowerCase()) || onlyLevels.includes(String(r.name).toLowerCase()))
    .map(r => r.dir);
  const t = { levels: levels.length, scanned: 0, failed: [], hulls: 0, guns: 0, pairs: 0, levelsWithPairs: 0,
    neighbours: 0, rows: {} };
  for (const name of levels) {
    let result;
    try { result = censusLevel(tree, name); } catch (e) { t.failed.push(`${name}: ${e.message}`); if (process.env.CENSUS_DEBUG) console.error(e.stack); continue; }
    if (!result) { t.failed.push(`${name}: no scene or heightfield`); continue; }
    t.scanned++;
    t.hulls += result.hulls;
    t.guns += result.guns;
    t.pairs += result.rows.length;
    t.neighbours += new Set(result.rows.map(r => `${r.neighbour}@${r.neighbourAt}`)).size;
    if (result.rows.length) { t.levelsWithPairs++; t.rows[name] = result.rows; }
    process.stderr.write(`${tree.id}/${name} (${result.mode}): ${result.hulls} hulls, ${result.guns} splash guns, ${result.rows.length} rest-fire neighbours\n`);
  }
  report[tree.id] = t;
  console.log(`${tree.id}: ${t.scanned}/${t.levels} levels, ${t.hulls} hulls, ${t.guns} splash guns; `
    + `${t.pairs} gun-to-hull pairs (${t.neighbours} hulls) on ${t.levelsWithPairs} levels`
    + (t.failed.length ? `; ${t.failed.length} failed` : ''));
}
const out = opt('--json');
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
