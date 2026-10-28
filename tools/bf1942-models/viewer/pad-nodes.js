// Which placed node stands for which vehicle pad: the template a node stands
// for, the level's own node for an `objectSpawns` row, the template a pad
// stands first as the round opens, and which hulls the load settle settles
// together. Split out of `level-statics.js` (which re-exports it) so the body
// modules (`hull-bodies.js`, the room's `server/level-bodies.mjs`) reach it
// without the scene-building half.

import * as THREE from 'three';
import { followPadPoint, padControlPoint, padFromSpawn } from './deployables.js';

const kindOf = obj => obj?.userData?.kind || '';
const _padAt = new THREE.Vector3();

/** The template a placed node stands for: its `control` tag, whole, else its
 *  name less the suffix GLTFLoader gives a repeated scene name (`Sherman_1`).
 *  The tag was cut the same way until 2026-10-28, which made every template
 *  whose own name ends in `_<digits>` no pad's (FHSWEurope's T-34_1942, L3_33,
 *  Flak103_38: 118 templates over the local trees): `bakedPadNode` found no
 *  node for its pads, so they spawned nothing and never changed sides. */
export function padTemplateOf(node) {
  const control = node?.userData?.control;
  if (control) return String(control);
  return String(node?.name || '').replace(/_\d+$/, '');
}

export function isKitNode(node) {
  return node?.userData?.templateKind?.toLowerCase?.() === 'kit';
}

/** The level's own node for a pad: a spawners child of the pad's template,
 *  the nearest one to the pad within `reach` metres, and not one another pad
 *  has `claimed`. A room's vehicle table finds its pads' nodes with this too
 *  (`server/vehicle-table.mjs`). */
export function bakedPadNode(spawners, spawn, reach = 3, claimed = null) {
  const want = String(spawn?.vehicle ?? '').toLowerCase();
  const p = spawn?.position;
  if (!want || !Array.isArray(p) || p.length !== 3) return null;
  let best = null;
  let bestD = reach;
  for (const child of spawners.children) {
    if (child.userData?.padVariant || isKitNode(child) || claimed?.has(child)) continue;
    if (padTemplateOf(child).toLowerCase() !== want) continue;
    child.getWorldPosition(_padAt);
    const d = Math.hypot(_padAt.x - p[0], _padAt.y - p[1], _padAt.z - p[2]);
    if (d < bestD) { best = child; bestD = d; }
  }
  return best;
}

/**
 * The template a pad stands first, as the round opens: its `SpawnerPad`
 * (`padFromSpawn`) given the team of the point it is filed under
 * (`followPadPoint`, SPAWN-12, SPAWN-19), or null when it hands out nothing
 * then (a side with no entry spawns nothing, SPAWN-2, or the pad is off).
 */
export function padFirstTemplate(spawn, points = [], anyOsId = false) {
  const pad = padFromSpawn(spawn);
  pad.reset();
  const name = padControlPoint(spawn, points, anyOsId);
  const point = name ? points.find(p => p?.name === name) : null;
  const team = name ? (point ? (point.team ?? 0) : null) : null;
  followPadPoint({ spawn, pad, held: null, point: name, flag: null }, team);
  return pad.active ? pad.templateFor() : null;
}

/**
 * Which placed hulls stand in the world together as the round opens, for the
 * load settle (`hull-bodies.js` `settlePlacedVehicles`, the room's
 * `server/level-bodies.mjs` `settle`). Returns `groupOf(node)`: `'start'` for
 * every hull that is no pad's and for the node each pad stands first
 * (`padFirstTemplate`), and a key of its own for every other node of a pad
 * (its other side's, `loadPadVariants`, or a template no side that can hold
 * the pad hands out), which is settled alone.
 *
 * The engine has a pad's hull only once the pad spawns it (`spawnObject`
 * stands it at the spawner's pose, SPAWN-28), and only the template of the
 * pad's live team (SPAWN-2). The page has every one of them at its pad's pose
 * at load, and settled with the round's own hulls one that is never there
 * shoved them: FHSWEurope Pasir Panjang's `mobile_aa_allies` LightAA_MkI,
 * filed under the axis base that never changes hands and so never spawned,
 * stands 0.5 m from `mobile_aa_axis`'s Type94 twin AA and pushed it 4.25 m;
 * The Storm's T-34_1942 (a Soviet entry on a pad its axis point holds)
 * shoved, and was shoved 3.2 m by, the KV9 2.3 m beside it
 * (features/fhsweurope-extraction, 2026-10-28 "Four hulls that moved on
 * their pads").
 */
export function settleGroupsOf(ownerRoots, extras) {
  const start = () => 'start';
  const spawns = extras?.objectSpawns;
  if (!Array.isArray(spawns) || !spawns.length) return start;
  const spawners = ownerRoots.find(node => node?.parent && (kindOf(node.parent) === 'spawners'
    || node.parent.name === 'spawners'))?.parent;
  if (!spawners) return start;
  const points = Array.isArray(extras.controlPoints) ? extras.controlPoints : [];
  const anyOsId = spawns.some(s => Number.isFinite(s?.osId));
  spawners.updateMatrixWorld(true);
  const variants = new Map();
  for (const child of spawners.children) {
    const index = child.userData?.objectSpawn;
    if (!child.userData?.padVariant || !Number.isInteger(index)) continue;
    if (!variants.has(index)) variants.set(index, []);
    variants.get(index).push(child);
  }
  const groups = new Map();
  const claimed = new Set();
  spawns.forEach((spawn, index) => {
    // The pad records' own match (`buildVehiclePads`).
    const baked = bakedPadNode(spawners, spawn, 3, claimed);
    if (!baked) return;
    claimed.add(baked);
    const first = String(padFirstTemplate(spawn, points, anyOsId) ?? '').toLowerCase();
    for (const node of [baked, ...(variants.get(index) ?? [])]) {
      if (padTemplateOf(node).toLowerCase() !== first) groups.set(node, `pad ${index} ${padTemplateOf(node)}`);
    }
  });
  return node => groups.get(node) ?? 'start';
}
