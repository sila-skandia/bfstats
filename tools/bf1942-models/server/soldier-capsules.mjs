// A soldier's hit capsules on the room server: the engine's
// `setSkeletonCollisionBone` table (`gaits.json` `soldierBody.collisionBones`,
// `viewer/skeleton-hit.js` has the rule) on the soldier's own skeleton, posed
// in his stance, so a round the room flies (`room-guns.mjs`) meets his head as
// his head (material 40), his chest as his chest (41) and a limb as a limb
// (42), as the page's own round does on the body it draws
// (`viewer/rig-capsules.js`).
//
// Retail's server runs every soldier's skeleton and tests a round against the
// capsules on it. The room draws nothing, so its skeleton is read out of the
// files the page poses a body from, as data: the rig's node tree
// (`poses/rigs/<Soldier>.rig.glb`, the JSON chunk alone), one of that
// soldier's pose recipes (`poses/<Soldier>__<Pose>.pose.json`: the joints'
// rest transforms and the three constant stance clips, `stand`, `crouch` and
// `lie`), and the table. One set of capsules a stance, in the body's own
// frame (feet at the origin, forward +Z), laid on a soldier by his place and
// yaw at the moment of the test.
//
// A DEPARTURE, stated: it is the stance's still pose. The walk and run cycles,
// the aim's pitch, the torso's twist and a death's fall are not played here,
// so a running man's forearm is where it rests, not where it swings. A soldier
// in a seat keeps the stand-in sphere (`room-guns.mjs`), and so does everyone
// on a tree without the pose files or the rig's blob (`glbs/`).
//
// The exporter now writes the posed skeleton itself, `poses/stances.json`
// (`extract_stances.py`, `bf42/stance.py`): where a tree has it, that is read
// and no rig is loaded. The rig path stays for a tree extracted before it.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import * as THREE from 'three';

import { loadVehicleTree } from './glb-tree.mjs';
import { boneKey, buildCapsules } from '../viewer/skeleton-hit.js';
import { POSE_CROUCH, POSE_PRONE } from '../viewer/soldier-pose.js';

/** The recipe clip a stance is posed from (`pose-compose.js` `recipeClips`). */
const STANCE_CLIP = Object.freeze({ stand: 'stand', crouch: 'crouch', prone: 'lie' });

const readJson = file => {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; }
};

/** The stance name of a soldier's `pose` (`soldier-pose.js`). */
export function stanceOf(pose) {
  return pose === POSE_PRONE ? 'prone' : pose === POSE_CROUCH ? 'crouch' : 'stand';
}

/**
 * The capsules of `table` on `soldier`'s skeleton in each stance, in the
 * body's frame: `{ stand, crouch, prone }`, each a list for
 * `skeleton-hit.js` `skeletonHit`, or null where the tree lacks a file.
 *
 * @param {object} options
 * @param {string[]} options.modelsDirs  the level's model trees, the mod's first
 * @param {string} [options.glbsDir]     the content store (`glbs/<sha>.glb`)
 * @param {string} options.soldier       the soldier template (`BritishSoldier`)
 * @param {object[]} options.table       `soldierBody.collisionBones`
 */
export function loadStanceCapsules({ modelsDirs = [], glbsDir = null, soldier, table }) {
  if (!soldier || !table?.length) return null;
  for (const dir of modelsDirs) {
    const poses = join(dir, 'poses');
    // The exporter's own answer first (`poses/stances.json`,
    // `extract_stances.py`): the bones where they are in each stance, so
    // nothing below is needed, neither the rig's blob nor the content store.
    const exported = exportedStances(readJson(join(poses, 'stances.json')), soldier, table);
    if (exported) return exported;
    const index = readJson(join(poses, 'index.json'));
    // Any of the soldier's recipes: the skeleton and the stance clips' legs,
    // spine and head are the soldier's, whatever he holds.
    let recipeFile = null;
    const prefix = `${soldier}__`.toLowerCase();
    const named = (index?.recipe ?? []).find(stem => String(stem).toLowerCase().startsWith(prefix));
    if (named && existsSync(join(poses, `${named}.pose.json`))) recipeFile = join(poses, `${named}.pose.json`);
    if (!recipeFile) {
      let files = [];
      try { files = readdirSync(poses); } catch { /* a tree without poses */ }
      const found = files.find(f => f.toLowerCase().startsWith(prefix) && f.endsWith('.pose.json'));
      if (found) recipeFile = join(poses, found);
    }
    const recipe = recipeFile ? readJson(recipeFile) : null;
    if (!recipe?.rig || !recipe.clips) continue;
    // The rig: its own file, else its blob in the content store.
    const sha = index?.sha?.[recipe.rig] ?? null;
    const rigFile = [join(poses, recipe.rig), sha && glbsDir ? join(glbsDir, `${sha}.glb`) : null]
      .find(file => file && existsSync(file));
    if (!rigFile) continue;
    try {
      return poseCapsules(loadVehicleTree(rigFile), recipe, table);
    } catch { /* an unreadable rig: the next tree */ }
  }
  // No tree poses him on foot: the first tree's shared body.
  for (const dir of modelsDirs) {
    const shared = exportedStances(readJson(join(dir, 'poses', 'stances.json')), soldier, table, { orDefault: true });
    if (shared) return shared;
  }
  return null;
}

/** `poses/stances.json`'s format (`bf42/stance.py`). */
const STANCE_BODIES_FORMAT = 'bf1942-stance-bodies/1';

/**
 * A soldier's stances out of a tree's `stances.json`: the same
 * `{ stand, crouch, prone, bones }` the rig answers below, or null when the
 * file is absent, another format, or holds no such soldier (found whatever
 * his name's case, as the engine finds a template).
 */
export function exportedStances(doc, soldier, table, { orDefault = false } = {}) {
  if (doc?.format !== STANCE_BODIES_FORMAT || !doc.soldiers || !table?.length) return null;
  const want = String(soldier).toLowerCase();
  const name = Object.keys(doc.soldiers).find(key => key.toLowerCase() === want);
  // `orDefault`: a soldier the tree poses only in seats takes the body most
  // of its soldiers share (`default`); the skeleton is the same one.
  const body = name ? doc.bodies?.[doc.soldiers[name].body]
    : orDefault && doc.default != null ? doc.bodies?.[doc.default] : null;
  if (!body?.names?.length) return null;
  const index = new Map();
  body.names.forEach((bone, i) => { const key = boneKey(bone); if (!index.has(key)) index.set(key, i); });
  const out = {};
  for (const stance of Object.keys(STANCE_CLIP)) {
    const posed = body[stance];
    if (!posed?.bones?.length) continue;
    const caps = buildCapsules(table, bone => {
      const i = index.get(boneKey(bone));
      return i === undefined ? null : { bone: posed.bones[i], parent: posed.parents[i] };
    });
    out[stance] = caps.length ? caps : null;
    (out.bones ??= {})[stance] = posed.bones;
  }
  return out.stand || out.crouch || out.prone ? out : null;
}

/**
 * The one body a headless world's soldiers are hit on and aimed at: the
 * room server (`room-guns.mjs`) and the headless runner (`sim/match.mjs`)
 * both build it, so a bot's round, a human's round and a bot's aim meet the
 * same capsules and bones in either. The page reads the same table off the
 * body it draws (`viewer/rig-capsules.js` `rigCapsules`, `rigBones`).
 *
 * @param {object} options
 * @param {string[]} options.modelsDirs  the level's model trees, the mod's first
 * @param {string} [options.glbsDir]     the content store
 * @param {object[]} options.table       `soldierBody.collisionBones`
 * @param {(team:number)=>string|null} options.soldierOf  a side's soldier template
 * @param {Map} [options.cache]          side -> stances, kept by the caller's level
 */
export function createStanceBodies({ modelsDirs = [], glbsDir = null, table = null, soldierOf, cache = new Map() }) {
  const stancesOf = team => {
    if (!cache.has(team)) {
      let stances = null;
      try {
        stances = loadStanceCapsules({ modelsDirs, glbsDir, soldier: soldierOf?.(team) ?? null, table });
      } catch { stances = null; }
      cache.set(team, stances);
    }
    return cache.get(team);
  };
  /** A soldier on foot's capsules in his stance, in the body's frame (feet
   *  at the origin, forward +Z); null in a seat and on a tree without the
   *  pose files (the stand-in sphere then). */
  const capsulesFor = player => {
    if (!player?.soldier || player.occupancy) return null;
    return stancesOf(player.team)?.[stanceOf(player.soldier.pose)] ?? null;
  };
  /** His skeleton's bones in that stance, in the body's frame and the
   *  skeleton's own order: what a bot's sense rays and aim pick among
   *  (`bot-sense.js` `soldierBones`, ledger AI-123). */
  const bonesFor = player => {
    if (!player?.soldier || player.occupancy) return null;
    return stancesOf(player.team)?.bones?.[stanceOf(player.soldier.pose)] ?? null;
  };
  /** His capsules where he stands now, in the world (the referee's
   *  `capsulesOf`, `vehicle-hits.js` `roundBodyCast`). */
  const capsulesAt = player => {
    const caps = capsulesFor(player);
    if (!caps) return null;
    const s = player.soldier;
    const c = Math.cos(s.yaw ?? 0), n = Math.sin(s.yaw ?? 0);
    const put = p => [s.x + p[0] * c + p[2] * n, s.y + p[1], s.z - p[0] * n + p[2] * c];
    return caps.map(cap => ({ ...cap, a: put(cap.a), b: put(cap.b), origin: put(cap.origin) }));
  };
  /** Whether a side's soldiers have a posed skeleton here (the pose files
   *  and the rig were found), for a caller that reports which body it ran. */
  const posed = team => !!stancesOf(team);
  return { capsulesFor, bonesFor, capsulesAt, posed };
}

/** The capsules of every stance on a rig tree posed by `recipe`. */
export function poseCapsules(rig, recipe, table) {
  // `loadVehicleTree` hands back a one-node scene's node itself: under a
  // holder, the rig's own root is walked like any node.
  const scene = new THREE.Group();
  scene.add(rig);
  const joints = new Map();
  scene.traverse(node => {
    if (node.userData?.rigRoot && recipe.root?.q) node.quaternion.fromArray(recipe.root.q);
    if (!node.userData?.joint) return;
    const key = boneKey(node.name);
    if (!joints.has(key)) joints.set(key, node);
  });
  const apply = values => {
    for (const [bone, v] of Object.entries(values ?? {})) {
      const node = joints.get(boneKey(bone));
      if (!node) continue;
      node.quaternion.set(v[0], v[1], v[2], v[3]);
      node.position.set(v[4], v[5], v[6]);
    }
  };
  const bone = new THREE.Vector3();
  const parent = new THREE.Vector3();
  const out = {};
  for (const [stance, clip] of Object.entries(STANCE_CLIP)) {
    apply(recipe.joints);
    apply(recipe.clips?.[clip]?.still);
    scene.updateMatrixWorld(true);
    const caps = buildCapsules(table, name => {
      const node = joints.get(boneKey(name));
      if (!node?.parent) return null;
      node.getWorldPosition(bone);
      node.parent.getWorldPosition(parent);
      return { bone: bone.toArray(), parent: parent.toArray() };
    });
    out[stance] = caps.length ? caps : null;
    // Every bone where it is in this stance, in the skeleton's own order:
    // the points a bot's sense rays pick among (`bot-sense.js` `_rays`,
    // `pickSoldierRandomSensePosition`).
    (out.bones ??= {})[stance] = [...joints.values()].map(node => node.getWorldPosition(new THREE.Vector3()).toArray());
  }
  return out.stand || out.crouch || out.prone ? out : null;
}
