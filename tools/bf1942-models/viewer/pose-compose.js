// Composing a split pose back into the one document a viewer draws.
//
// A pose used to be a single `<Soldier>__<Pose>.pose.glb` carrying the body,
// the weapon and a few KB of pose. Measured 2026-09-25 that is 2.8 GB across
// four trees, in which the soldier's body is stored once per pose (36 times
// over for a vanilla soldier, 19 for an EoD one) and each weapon tree once per
// soldier who can hold it. Everything pose-specific is small — the rest pose,
// three constant stance clips, the weapon's transform under the hand — so the
// extractor's `--split` writes it as data instead:
//
//     poses/rigs/<Soldier>.rig.glb      body, face, hands, skeleton, textures
//     poses/<Soldier>__<Pose>.pose.json the pose, in the glb's own numbers
//     <Weapon>.glb                      the weapon, already published
//
// and this module puts them back together. The result is shaped like a
// `GLTFLoader` result — `{ scene, animations, userData }` — because every
// consumer already treats one that way, and the split path is not a second
// rendering path: it is the same scene, built from three files instead of one.
//
// **The recipe's numbers are the glb's numbers.** `joints` is the joint nodes'
// static transform, `clips` is the glb's `animations`, `attach` is the `grip`
// node's own transform — all in glTF space, so they are assigned straight onto
// a node or a keyframe track with no conversion here. `tools/bf1942-models/
// check_recipe.py` asserts that equality against a published tree, and
// `tests/test_pose_recipe.py` asserts it against the builder.
//
// The gait sidecars are untouched: a recipe names its two in `gaitAssets`
// exactly as a pose glb names them in `extras`, and the viewer retargets them
// by bone name as it always has.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { loadFirst, poseBases, poseUrls, rigUrls, weaponUrls } from './pose-bases.js';
import { boneKey } from './skeleton-hit.js';

export { boneKey };

/** What a recipe's `format` has to start with. A tree extracted before the
 *  format existed has no recipes and every reader falls back to the glb. */
export const RECIPE_FORMAT_PREFIX = 'bf1942-pose-recipe/';

/** The marker on a grafted subtree. Its geometry and materials are the cached
 *  weapon glb's, shared with every other soldier holding that weapon, so a
 *  figure's disposal must leave them alone (`ungraft`). */
export const GRAFT = 'poseGraft';

/**
 * A bone by name, tolerant of the underscore/space spellings the data mixes.
 * `boneKey` is `skeleton-hit.js`'s — the recipe keys come from the extractor
 * already in that form, and the capsule table names bones the same way.
 */
export function findBone(root, name) {
  const want = boneKey(name);
  let found = null;
  root.traverse(obj => { if (!found && boneKey(obj.name) === want) found = obj; });
  return found;
}

/** The joints of a composed scene, by `boneKey`. Only nodes the extractor
 *  marked as joints, so a weapon node that happens to share a name with a
 *  skeleton bone (the `Thompson` prop bone against the Thompson's own model
 *  root) cannot be mistaken for one. */
export function jointNodes(scene) {
  const nodes = new Map();
  scene.traverse(obj => {
    if (!obj.userData?.joint) return;
    const key = boneKey(obj.name);
    if (!nodes.has(key)) nodes.set(key, obj);
  });
  return nodes;
}

/** Whether `obj` is inside a grafted subtree. */
export function isGraft(obj) {
  for (let node = obj; node; node = node.parent) {
    if (node.userData?.[GRAFT]) return true;
  }
  return false;
}

/** Detach every grafted subtree from `root`, before it is disposed. */
export function ungraft(root) {
  const grafts = [];
  root.traverse(obj => { if (obj.userData?.[GRAFT]) grafts.push(obj); });
  for (const graft of grafts) graft.parent?.remove(graft);
  return grafts.length;
}

/**
 * Hide what the page never draws: an effect bundle's particles and any
 * collision mesh. The pose glbs were exported with `include_effects=False` and
 * no collision, so a monolithic pose never carried these at all — but the
 * standalone `<Weapon>.glb` does (it is the same export the model pages use),
 * and its muzzle flash would otherwise hang in the air off every rifle in the
 * level. One rule, applied to both paths, so the two draw the same thing.
 */
export function hideUnlit(scene) {
  scene.traverse(obj => {
    const data = obj.userData || {};
    if (data.effect || data.projectileMesh || data.projectileTrail
        || data.collision || /collision/i.test(obj.name || '')) {
      obj.visible = false;
    }
    if (obj.isSkinnedMesh) obj.frustumCulled = false;
  });
  return scene;
}

/** The extras the monolithic glb put on its root node, from the recipe. A
 *  weapon pose carried `soldier`, `weapon` and `state`; a seat pose carried
 *  `soldier`, `upperState`, `lowerState` and `poseKind`. */
function rootExtras(recipe) {
  if (recipe.kind === 'seat') {
    return { soldier: recipe.soldier, upperState: recipe.upperState,
             lowerState: recipe.lowerState, poseKind: 'seat' };
  }
  return { soldier: recipe.soldier, weapon: recipe.weapon ?? null,
           state: recipe.state };
}

/** The document extras a consumer reads, for a split pose. Shaped like the
 *  extras a pose glb carries, so `poses.html` and `pose-motion.js` need no
 *  second lookup. */
function userDataOf(recipe) {
  const data = {
    soldier: recipe.soldier,
    weapon: recipe.weapon ?? null,
    state: recipe.state,
    upperState: recipe.upperState,
    lowerState: recipe.lowerState,
    gaits: recipe.gaits ?? {},
    gaitAssets: recipe.gaitAssets,
    gaitClips: recipe.gaitClips,
    gaitSource: recipe.gaitSource,
    stanceClips: recipe.clipNames,
    recipe: true,
  };
  if (recipe.kind === 'seat') data.poseKind = 'seat';
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}

/** The keys a clip's bones share, from a recipe clip. */
function clipTracks(nodes, spec) {
  const tracks = [];
  const push = (node, quaternions, positions, times) => {
    const q = [];
    const p = [];
    for (const value of quaternions) q.push(...value);
    for (const value of positions) p.push(...value);
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`,
                                                  times, q));
    tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`,
                                              times, p));
  };
  if (spec.still) {
    // A constant clip: the same value at 0 and 1, which is exactly how the
    // pose glb writes `stand`/`crouch`/`lie` and why a crossfade between two
    // of them is a crossfade between two poses. The value has to be repeated
    // per key -- a track whose values are shorter than its times gives the
    // interpolant a fractional stride and the mixer spins on it.
    for (const [bone, values] of Object.entries(spec.still)) {
      const node = nodes.get(bone);
      if (!node) continue;
      const quaternion = values.slice(0, 4);
      const position = values.slice(4, 7);
      push(node, [quaternion, quaternion], [position, position], [0, 1]);
    }
    return tracks;
  }
  const times = spec.times || [];
  for (const [bone, keys] of Object.entries(spec.bones || {})) {
    const node = nodes.get(bone);
    if (!node) continue;
    push(node, keys.map(k => k.slice(0, 4)), keys.map(k => k.slice(4, 7)), times);
  }
  return tracks;
}

/** Every animation a recipe carries, as `AnimationClip`s bound by node name —
 *  the same binding a `GLTFLoader` gives a pose glb, and what lets a gait
 *  sidecar's clip (whose tracks are bone names too) drive this skeleton. */
export function recipeClips(scene, recipe) {
  const nodes = jointNodes(scene);
  const clips = [];
  for (const name of recipe.clipNames || Object.keys(recipe.clips || {})) {
    const spec = recipe.clips?.[name];
    if (!spec) continue;
    const tracks = clipTracks(nodes, spec);
    if (!tracks.length) continue;
    const duration = spec.still ? 1.0 : Math.max(0, ...(spec.times || [0]));
    clips.push(new THREE.AnimationClip(name, duration, tracks));
  }
  return clips;
}

/** Assign a recipe's joint transforms onto a composed scene's nodes. */
export function applyJoints(scene, joints) {
  const nodes = jointNodes(scene);
  for (const [bone, values] of Object.entries(joints || {})) {
    const node = nodes.get(bone);
    if (!node) continue;
    node.quaternion.set(values[0], values[1], values[2], values[3]);
    node.position.set(values[4], values[5], values[6]);
  }
  return nodes;
}

const value = field => (typeof field === 'function' ? field() : field);

// One cache for every composer in the page, keyed by URL: the rigs and the
// weapons are loader-independent documents, and the figure a level draws and
// the figure a bot draws are the same rig.
const assetCache = new Map();

/**
 * A composer over one page's loaders and model roots.
 *
 * `ctx`: `loader` (a `GLTFLoader`), `modelsBase` (the active mod's model root,
 * or a getter for it), `bust` (the cache-buster, or a getter), and optionally
 * `shade(scene)`, the page's level lighting.
 *
 * Every method resolves to a `GLTFLoader`-shaped result or to null. The caller
 * owns the result and clones it per figure, exactly as it did with a pose glb.
 *
 * `cache: false` is for a caller that disposes what it stages
 * (`controls-preview.js` swaps one figure in and frees it on every mode
 * switch): every call parses anew, so nothing it frees is still wanted. The
 * figure a level draws shares its rig with every other figure of that soldier
 * instead, which is the whole point of the split tree.
 */
export function createPoseComposer(ctx) {
  const shared = ctx.cache !== false;
  const poses = new Map();   // "soldier|weapon|bases" -> Promise<result|null>
  const seats = new Map();   // "soldier|pose|bases" -> Promise<result|null>

  const bases = () => poseBases(value(ctx.modelsBase));
  const bust = () => value(ctx.bust) ?? '';

  /** An asset by URL, loaded once for the whole page. */
  function asset(urls) {
    const list = Array.isArray(urls) ? urls : [urls];
    const load = () => loadFirst(value(ctx.loader), list).then(gltf => gltf, () => null);
    if (!shared) return load();
    // Keyed without the cache-buster. `bust` is a fresh timestamp per call, so
    // a key that kept it would give the rig a new entry per pose pair and
    // re-parse 750 KB of body for every soldier on the level that holds a
    // different weapon. The fetch still carries it.
    const key = list.map(url => url.split('?')[0]).join('|');
    if (!assetCache.has(key)) assetCache.set(key, load());
    return assetCache.get(key);
  }

  /** A pose's recipe, from the mod tree then vanilla's. */
  async function recipe(soldier, pose) {
    for (const url of poseUrls(value(ctx.modelsBase),
                               `${soldier}__${pose}.pose.json`, bust())) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const doc = await response.json();
        if (String(doc?.format || '').startsWith(RECIPE_FORMAT_PREFIX)) return doc;
      } catch { /* the next root, or a tree with no recipes at all */ }
    }
    return null;
  }

  /** The monolithic pose, for a tree that has no recipe for this pair. */
  async function monolithic(soldier, pose) {
    try {
      const gltf = await loadFirst(value(ctx.loader),
                                   poseUrls(value(ctx.modelsBase),
                                            `${soldier}__${pose}.pose.glb`, bust()));
      hideUnlit(gltf.scene);
      ctx.shade?.(gltf.scene);
      return { scene: gltf.scene, animations: gltf.animations ?? [],
               userData: gltf.userData ?? {}, weaponName: gltf.userData?.weapon ?? null,
               recipe: null };
    } catch {
      return null;
    }
  }

  /**
   * A recipe's three documents, composed: the rig cloned and posed, the weapon
   * grafted under the hand bone at the recipe's transform, and the recipe's
   * clips built onto the rig's own skeleton.
   *
   * Each half resolves across the trees on its own (`pose-bases.js`), so a mod
   * recipe naming a vanilla soldier and a mod weapon gets vanilla's rig and the
   * mod's weapon.
   */
  async function compose(doc) {
    const rigGltf = await asset(rigUrls(value(ctx.modelsBase), doc.soldier, bust()));
    if (!rigGltf) return null;
    // A clone per pose: the rig is one document per soldier, and two poses of
    // the same soldier are drawn at once. `skeletonClone` rebinds every skinned
    // mesh to this clone's own bones, so the two do not fight over the cache's
    // joints; geometry, materials and textures stay shared.
    const scene = skeletonClone(rigGltf.scene);
    scene.traverse(node => {
      if (!node.userData?.rigRoot) return;
      if (doc.root?.name) node.name = doc.root.name;
      if (doc.root?.q) {
        node.quaternion.set(doc.root.q[0], doc.root.q[1],
                            doc.root.q[2], doc.root.q[3]);
      }
      // The monolithic glb's root node carried the pose's own extras, and a
      // reader that reaches for `scene.userData` rather than `gltf.userData`
      // (`arms-rig.js`) finds them either way.
      Object.assign(node.userData, rootExtras(doc));
    });
    const nodes = applyJoints(scene, doc.joints);

    if (doc.weapon && doc.attach) {
      const weapon = await asset(weaponUrls(value(ctx.modelsBase), doc.weapon, bust()));
      if (weapon) {
        const wrapper = new THREE.Group();
        wrapper.name = `${doc.weapon} grip`;
        wrapper.userData[GRAFT] = doc.weapon;
        wrapper.userData.weapon = doc.weapon;
        wrapper.userData.weldBone = doc.attach.bone || 'Bip01 R Hand';
        if (doc.attach.q) {
          wrapper.quaternion.set(doc.attach.q[0], doc.attach.q[1],
                                 doc.attach.q[2], doc.attach.q[3]);
        }
        if (doc.attach.t) {
          wrapper.position.set(doc.attach.t[0], doc.attach.t[1], doc.attach.t[2]);
        }
        // A clone, so two soldiers holding one rifle do not share a node tree
        // and so the cached weapon document stays whole for the next pose.
        wrapper.add(weapon.scene.clone(true));
        const hand = nodes.get(boneKey(doc.attach.bone || 'Bip01 R Hand'));
        (hand || scene).add(wrapper);
      }
    }

    hideUnlit(scene);
    ctx.shade?.(scene);
    return { scene, animations: recipeClips(scene, doc), userData: userDataOf(doc),
             weaponName: doc.weapon ?? null, recipe: doc };
  }

  /** The split pose when the tree has one, the monolithic glb when it does not. */
  async function load(soldier, pose) {
    const doc = await recipe(soldier, pose);
    if (doc) {
      const composed = await compose(doc);
      if (composed) return composed;
    }
    return monolithic(soldier, pose);
  }

  function cached(store, key, load) {
    if (!shared) return load().catch(() => null);
    if (!store.has(key)) store.set(key, load().catch(() => null));
    return store.get(key);
  }

  return {
    /** `soldier` holding `weapon`. */
    pose(soldier, weapon) {
      return cached(poses, `${soldier}|${weapon}|${bases().join(',')}`,
                    () => load(soldier, weapon));
    },
    /** `soldier` in the seat pose `pose` (`SitInVehicle`, `PassengerInWilly`). */
    seat(soldier, pose) {
      return cached(seats, `${soldier}|${pose}|${bases().join(',')}`,
                    () => load(soldier, pose));
    },
  };
}
