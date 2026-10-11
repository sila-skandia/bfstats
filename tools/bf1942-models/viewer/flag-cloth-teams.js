// A control point's cloth per owner. Retail swaps the WHOLE mesh when a point
// changes hands (`ObjectTemplate.setTeamGeometry <team> <mesh>`), so a level
// baked by `extract_map.py` carries every cloth a point can wear as a
// skinned mesh over the point's one set of joints (`kind: flagCloth` for the
// starting owner's, `flagClothAlt` for the rest, each with `extras.point`,
// `extras.mesh` and `extras.teams`). Only the holder's is drawn. Scenes baked
// before that carry the one cloth and no `extras.teams`; the page falls back
// to repainting its UVs inside the `flags_o` atlas (capture.js).
//
// The scene root's children are the page's distance-cull set, and the cull
// writes `.visible` on every one of them each frame, so a cloth that is not
// the holder's is taken OUT of that set rather than merely hidden.

import * as THREE from 'three';

const KINDS = new Set(['flagCloth', 'flagClothAlt']);

/** `<point> cloth` as the scene graph holds it (GLTFLoader's rename). */
export function flagStem(pointName) {
  return THREE.PropertyBinding.sanitizeNodeName(pointName);
}

const registries = new WeakMap();

/** The per-team cloths of one level root, by sanitized point name. Only
 *  nodes that name their owners count: a legacy cloth has none. */
export function teamClothIndex(root) {
  let index = registries.get(root);
  if (index) return index;
  index = new Map();
  root.traverse(obj => {
    const data = obj.userData;
    if (!obj.isSkinnedMesh || !KINDS.has(data?.kind)) return;
    if (!Array.isArray(data.teams) || !data.point) return;
    const stem = flagStem(data.point);
    if (!index.has(stem)) index.set(stem, []);
    index.get(stem).push(obj);
  });
  // An empty answer is not remembered: a root that has none may be asked
  // again once the page has added some, and a legacy level costs one walk
  // per capture, which is rare.
  if (index.size) registries.set(root, index);
  return index;
}

export function teamClothsOf(root, pointName) {
  if (!root || !pointName) return null;
  const list = teamClothIndex(root).get(flagStem(pointName));
  return list && list.length ? list : null;
}

function drop(cull, obj) {
  const at = cull.indexOf(obj);
  if (at < 0) return false;
  cull.splice(at, 1);
  return true;
}

/** Make `team`'s cloth of a point the one drawn: its own mesh when it has
 *  one, and no cloth at all when the owner names none (the point is a bare
 *  pole, as retail draws it). Returns `{ shown, changed }`. */
export function showTeamCloth(root, pointName, team, cull) {
  const list = teamClothsOf(root, pointName);
  if (!list) return null;
  const want = list.find(c => c.userData.teams.includes(team)) || null;
  let changed = false;
  for (const cloth of list) {
    if (cloth === want) {
      cloth.visible = true;
      if (!cull.includes(cloth)) { cull.push(cloth); changed = true; }
    } else {
      cloth.visible = false;
      if (drop(cull, cloth)) changed = true;
    }
  }
  return { shown: want, changed };
}

/** At level load, after the scene index: every cloth that is not the
 *  starting owner's leaves the cull set and the frame. `startTeam(pointName)`
 *  answers a point's starting owner; the baked main cloth already is it, so
 *  only the alternates and a main that no longer matches are hidden. */
export function armTeamCloths(root, cull, flattenCull) {
  registries.delete(root);
  const index = teamClothIndex(root);
  let hidden = 0;
  for (const list of index.values()) {
    for (const cloth of list) {
      if (cloth.userData.kind !== 'flagClothAlt') continue;
      cloth.visible = false;
      drop(cull, cloth);
      hidden++;
    }
  }
  if (hidden && flattenCull) flattenCull();
  return hidden;
}

/** Give a control point's nodes back the names the file spelled.
 *
 *  A level holds every game mode's poles and cloths: a point whose starting
 *  owner differs between modes is two sets of `<point>`, `<point> flag`,
 *  `<point> cloth` and `<point> BoneNN` nodes (`union_control_points`).
 *  GLTFLoader gives the second set of a name `_1` (`createUniqueName`), so
 *  once `pruneToMode` has dropped the first set the live poles of that mode
 *  are `<point>_1` and every lookup by the point's name -- the capture's pole
 *  and cloth, and every `FlagBlow` track's joint -- found nothing: nothing
 *  raised, nothing swapped, nothing waved, in whichever mode came second
 *  (Gold Beach's SinglePlayer: all five points but `beach`). The loader keeps
 *  the file's own spelling in `userData.name`; with the other mode's set gone
 *  the plain name is free again. Runs after `pruneToMode`; returns how many
 *  nodes it renamed. */
export function restoreFlagNodeNames(root) {
  const live = new Set();
  root.traverse(obj => { if (obj.name) live.add(obj.name); });
  let renamed = 0;
  root.traverse(obj => {
    const data = obj.userData;
    if (!data || typeof data.name !== 'string' || !obj.name) return;
    const flagNode = KINDS.has(data.kind) || data.kind === 'flagAnchor'
      || data.joint === true || obj.parent?.userData?.kind === 'controlPoints';
    if (!flagNode) return;
    const want = THREE.PropertyBinding.sanitizeNodeName(data.name);
    if (!want || obj.name === want || !/_\d+$/.test(obj.name)) return;
    if (obj.name.slice(0, want.length) !== want || live.has(want)) return;
    live.delete(obj.name);
    live.add(want);
    obj.name = want;
    renamed++;
  });
  return renamed;
}
